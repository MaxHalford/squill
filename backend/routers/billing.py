import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from polar_sdk import Polar
from polar_sdk.webhooks import validate_event, WebhookVerificationError
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from models import User
from services.auth import get_current_user

router = APIRouter(prefix="/billing", tags=["billing"])
logger = logging.getLogger(__name__)

# Initialize Polar client
polar = Polar(
    access_token=settings.polar_access_token,
    server=settings.polar_server,  # type: ignore
)


# Response Models


class CheckoutSessionResponse(BaseModel):
    checkout_url: str


# Polar API helper


async def cancel_polar_subscription(subscription_id: str) -> bool:
    """Cancel a subscription via Polar API."""
    if not subscription_id:
        return False

    try:
        polar.subscriptions.cancel(id=subscription_id)
        logger.info(f"Canceled Polar subscription {subscription_id}")
        return True
    except Exception as e:
        logger.error(f"Error canceling subscription {subscription_id}: {e}")
        return False


# Endpoints


@router.post("/checkout-session", response_model=CheckoutSessionResponse)
async def create_checkout_session(user: User = Depends(get_current_user)):
    """Create a Polar checkout session for Pro subscription."""
    if user.plan == "pro":
        raise HTTPException(status_code=400, detail="Already subscribed to Pro")

    try:
        checkout = polar.checkouts.create(
            request={
                "products": [settings.polar_product_id],
                "success_url": f"{settings.frontend_url}/account?checkout=success&checkout_id={{CHECKOUT_ID}}",
                "customer_email": user.email,
                "embed_origin": settings.frontend_url,
                "metadata": {"user_id": user.id},
            }
        )
        return CheckoutSessionResponse(checkout_url=checkout.url)
    except Exception as e:
        logger.error(f"Failed to create checkout session: {e}")
        raise HTTPException(status_code=500, detail="Failed to create checkout session")


@router.post("/webhook")
async def polar_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Handle Polar webhook events."""
    payload = await request.body()
    headers = dict(request.headers)

    try:
        event = validate_event(payload, headers, settings.polar_webhook_secret)
    except WebhookVerificationError as e:
        logger.error(f"Webhook verification failed: {e}")
        raise HTTPException(status_code=400, detail="Invalid signature")

    event_type = event.TYPE
    data = event.data

    logger.info(f"Received Polar webhook: {event_type}")

    if event_type == "subscription.created":
        await handle_subscription_created(data, db)
    elif event_type == "subscription.updated":
        await handle_subscription_updated(data, db)
    elif event_type == "subscription.canceled":
        await handle_subscription_canceled(data, db)
    # Ignore other events like checkout.created, checkout.updated, etc.

    return {"status": "ok"}


# Webhook Handlers


async def handle_subscription_created(subscription, db: AsyncSession):
    """Handle new subscription - activate Pro plan."""
    customer_id = subscription.customer_id
    subscription_id = subscription.id
    customer_email = subscription.customer.email if subscription.customer else None

    if not customer_email:
        # Try to get email from metadata
        metadata = subscription.metadata or {}
        user_id = metadata.get("user_id")
        if user_id:
            result = await db.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if user:
                customer_email = user.email

    if not customer_email:
        logger.warning(f"No email found in subscription.created for {subscription_id}")
        return

    result = await db.execute(select(User).where(User.email == customer_email))
    user = result.scalar_one_or_none()

    if not user:
        logger.warning(f"User not found for email {customer_email}")
        return

    user.plan = "pro"
    user.polar_customer_id = customer_id
    user.polar_subscription_id = subscription_id

    if subscription.current_period_end:
        user.plan_expires_at = subscription.current_period_end

    await db.commit()
    logger.info(f"Activated Pro for user {customer_email}")


async def handle_subscription_updated(subscription, db: AsyncSession):
    """Handle subscription updates (renewal, etc.)."""
    subscription_id = subscription.id
    status = subscription.status

    result = await db.execute(
        select(User).where(User.polar_subscription_id == subscription_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        logger.warning(f"User not found for subscription {subscription_id}")
        return

    if status == "active":
        user.plan = "pro"
        if subscription.current_period_end:
            user.plan_expires_at = subscription.current_period_end
        logger.info(f"Updated subscription for user {user.email}, status: {status}")
    elif status == "canceled":
        # Subscription canceled but may still be active until period ends
        logger.info(f"Subscription canceled for user {user.email}")
    elif status == "past_due":
        logger.warning(f"Subscription past_due for user {user.email}")

    await db.commit()


async def handle_subscription_canceled(subscription, db: AsyncSession):
    """Handle subscription cancellation (end of billing period)."""
    subscription_id = subscription.id

    result = await db.execute(
        select(User).where(User.polar_subscription_id == subscription_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        logger.warning(f"User not found for canceled subscription {subscription_id}")
        return

    user.plan = "free"
    user.polar_subscription_id = None
    user.plan_expires_at = None
    # Keep polar_customer_id for potential resubscription

    await db.commit()
    logger.info(f"Subscription ended for user {user.email}")
