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
    server=settings.polar_server,  # type: ignore[arg-type]
)


# Response Models


class CheckoutSessionResponse(BaseModel):
    checkout_url: str


# Polar API helper


async def cancel_polar_subscription(subscription_id: str) -> bool:
    """Cancel a subscription via Polar API (at period end)."""
    if not subscription_id:
        return False

    try:
        # Use update with cancel_at_period_end to allow access until period ends
        polar.subscriptions.update(
            id=subscription_id,
            subscription_update={"cancel_at_period_end": True},
        )
        logger.info(f"Canceled Polar subscription {subscription_id} (at period end)")
        return True
    except Exception:
        logger.exception(f"Error canceling subscription {subscription_id}")
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


@router.post("/cancel-subscription")
async def cancel_subscription(user: User = Depends(get_current_user)):
    """Cancel the user's Pro subscription."""
    if user.plan != "pro":
        raise HTTPException(status_code=400, detail="No active subscription to cancel")

    if not user.polar_subscription_id:
        raise HTTPException(status_code=400, detail="No subscription found")

    success = await cancel_polar_subscription(user.polar_subscription_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to cancel subscription")

    return {"status": "ok"}


@router.post("/resubscribe")
async def resubscribe(user: User = Depends(get_current_user)):
    """Resubscribe by uncanceling a pending cancellation."""
    if not user.subscription_cancel_at_period_end:
        raise HTTPException(status_code=400, detail="No pending cancellation to undo")

    if not user.polar_subscription_id:
        raise HTTPException(status_code=400, detail="No subscription found")

    try:
        # Uncancel the subscription
        polar.subscriptions.update(
            id=user.polar_subscription_id,
            subscription_update={"cancel_at_period_end": False},
        )
        logger.info(f"Resubscribed user {user.email}")
        return {"status": "ok"}
    except Exception:
        logger.exception(f"Error resubscribing user {user.email}")
        raise HTTPException(status_code=500, detail="Failed to resubscribe")


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
    subscription = event.data

    logger.info(f"Received Polar webhook: {event_type}")

    if event_type == "subscription.active":
        # Payment succeeded, subscription is now active
        await handle_subscription_active(subscription, db)
    elif event_type == "subscription.canceled":
        # User canceled, but subscription remains active until period ends
        await handle_subscription_canceled(subscription, db)
    elif event_type == "subscription.uncanceled":
        # User resubscribed before period ended
        await handle_subscription_uncanceled(subscription, db)
    elif event_type == "subscription.revoked":
        # Subscription has ended (after cancellation period or immediate revoke)
        await handle_subscription_revoked(subscription, db)
    elif event_type == "subscription.past_due":
        # Payment failed
        await handle_subscription_past_due(subscription, db)
    elif event_type == "subscription.updated":
        # General updates (renewal, plan change, etc.)
        await handle_subscription_updated(subscription, db)
    # Ignore: subscription.created (wait for active), checkout.*, etc.

    return {"status": "ok"}


# Webhook Handlers


async def handle_subscription_active(subscription, db: AsyncSession):
    """Handle subscription.active - payment succeeded, activate Pro plan."""
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
        logger.warning(f"No email found in subscription.active for {subscription_id}")
        return

    result = await db.execute(select(User).where(User.email == customer_email))
    user = result.scalar_one_or_none()

    if not user:
        logger.warning(f"User not found for email {customer_email}")
        return

    user.plan = "pro"
    user.polar_customer_id = customer_id
    user.polar_subscription_id = subscription_id
    user.subscription_cancel_at_period_end = False  # Fresh subscription

    if subscription.current_period_end:
        user.plan_expires_at = subscription.current_period_end

    await db.commit()
    logger.info(f"Activated Pro for user {customer_email}")


async def handle_subscription_updated(subscription, db: AsyncSession):
    """Handle subscription.updated - renewal, plan change, etc."""
    subscription_id = subscription.id

    result = await db.execute(
        select(User).where(User.polar_subscription_id == subscription_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        logger.warning(f"User not found for subscription {subscription_id}")
        return

    # Update expiration date on renewal
    if subscription.current_period_end:
        user.plan_expires_at = subscription.current_period_end

    await db.commit()
    logger.info(f"Updated subscription for user {user.email}")


async def handle_subscription_canceled(subscription, db: AsyncSession):
    """Handle subscription.canceled - user canceled but still has access until period ends."""
    subscription_id = subscription.id

    result = await db.execute(
        select(User).where(User.polar_subscription_id == subscription_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        logger.warning(f"User not found for canceled subscription {subscription_id}")
        return

    # Mark as canceling - user keeps Pro until period ends
    user.subscription_cancel_at_period_end = True
    if subscription.current_period_end:
        user.plan_expires_at = subscription.current_period_end

    await db.commit()
    logger.info(
        f"Subscription canceled for user {user.email}, "
        f"access until {subscription.current_period_end}"
    )


async def handle_subscription_uncanceled(subscription, db: AsyncSession):
    """Handle subscription.uncanceled - user resubscribed before period ended."""
    subscription_id = subscription.id

    result = await db.execute(
        select(User).where(User.polar_subscription_id == subscription_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        logger.warning(f"User not found for uncanceled subscription {subscription_id}")
        return

    # User resubscribed - clear the cancel flag
    user.subscription_cancel_at_period_end = False

    await db.commit()
    logger.info(f"Subscription reactivated for user {user.email}")


async def handle_subscription_revoked(subscription, db: AsyncSession):
    """Handle subscription.revoked - subscription has ended, remove Pro access."""
    subscription_id = subscription.id

    result = await db.execute(
        select(User).where(User.polar_subscription_id == subscription_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        logger.warning(f"User not found for revoked subscription {subscription_id}")
        return

    user.plan = "free"
    user.polar_subscription_id = None
    user.plan_expires_at = None
    user.subscription_cancel_at_period_end = False
    # Keep polar_customer_id for potential resubscription

    await db.commit()
    logger.info(f"Subscription ended for user {user.email}, reverted to free plan")


async def handle_subscription_past_due(subscription, db: AsyncSession):
    """Handle subscription.past_due - payment failed."""
    subscription_id = subscription.id

    result = await db.execute(
        select(User).where(User.polar_subscription_id == subscription_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        logger.warning(f"User not found for past_due subscription {subscription_id}")
        return

    # Log the issue - Polar will retry payment and send revoked if it fails permanently
    logger.warning(
        f"Payment failed for user {user.email}, subscription {subscription_id}. "
        "Polar will retry payment automatically."
    )
