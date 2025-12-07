import hashlib
import hmac
import logging
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database import get_db
from models import User
from services.auth import get_current_user

router = APIRouter(prefix="/billing", tags=["billing"])
logger = logging.getLogger(__name__)


# Response Models


class CheckoutSettingsResponse(BaseModel):
    price_id: str
    environment: str
    customer_email: str


# Paddle API helper


async def cancel_paddle_subscription(subscription_id: str) -> bool:
    """Cancel a subscription via Paddle API."""
    if not subscription_id:
        return False

    url = f"https://api.paddle.com/subscriptions/{subscription_id}/cancel"
    if settings.paddle_environment == "sandbox":
        url = f"https://sandbox-api.paddle.com/subscriptions/{subscription_id}/cancel"

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {settings.paddle_api_key}",
                    "Content-Type": "application/json",
                },
                json={"effective_from": "immediately"},
            )
            if response.status_code in (200, 201):
                logger.info(f"Canceled Paddle subscription {subscription_id}")
                return True
            else:
                logger.error(
                    f"Failed to cancel subscription {subscription_id}: {response.text}"
                )
                return False
        except Exception as e:
            logger.error(f"Error canceling subscription {subscription_id}: {e}")
            return False


# Endpoints


@router.get("/checkout-settings", response_model=CheckoutSettingsResponse)
async def get_checkout_settings(user: User = Depends(get_current_user)):
    """Get settings for Paddle.js checkout overlay. Requires authentication."""
    if user.plan == "pro":
        raise HTTPException(status_code=400, detail="Already subscribed to Pro")

    return CheckoutSettingsResponse(
        price_id=settings.paddle_price_id,
        environment=settings.paddle_environment,
        customer_email=user.email,
    )


def verify_paddle_signature(payload: bytes, signature: str) -> bool:
    """Verify Paddle webhook signature."""
    try:
        # Paddle uses ts;h1=hash format
        parts = dict(part.split("=", 1) for part in signature.split(";"))
        ts = parts.get("ts", "")
        h1 = parts.get("h1", "")

        if not ts or not h1:
            return False

        # Build signed payload: timestamp + ":" + payload
        signed_payload = f"{ts}:{payload.decode()}"
        expected_sig = hmac.new(
            settings.paddle_webhook_secret.encode(),
            signed_payload.encode(),
            hashlib.sha256,
        ).hexdigest()

        return hmac.compare_digest(expected_sig, h1)
    except Exception as e:
        logger.error(f"Signature verification error: {e}")
        return False


@router.post("/webhook")
async def paddle_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Handle Paddle webhook events."""
    payload = await request.body()
    signature = request.headers.get("paddle-signature", "")

    if not verify_paddle_signature(payload, signature):
        raise HTTPException(status_code=400, detail="Invalid signature")

    event = await request.json()
    event_type = event.get("event_type")
    data = event.get("data", {})

    logger.info(f"Received Paddle webhook: {event_type}")

    if event_type == "subscription.activated":
        await handle_subscription_activated(data, db)
    elif event_type == "subscription.updated":
        await handle_subscription_updated(data, db)
    elif event_type == "subscription.canceled":
        await handle_subscription_canceled(data, db)
    elif event_type == "transaction.completed":
        await handle_transaction_completed(data, db)

    return {"status": "ok"}


# Webhook Handlers


async def handle_subscription_activated(data: dict, db: AsyncSession):
    """Handle new subscription - activate Pro plan."""
    customer_id = data.get("customer_id")
    subscription_id = data.get("id")
    customer_email = data.get("customer", {}).get("email")

    if not customer_email:
        # Try to get email from custom_data
        custom_data = data.get("custom_data") or {}
        customer_email = custom_data.get("email")

    if not customer_email:
        logger.warning(f"No email found in subscription.activated for {subscription_id}")
        return

    result = await db.execute(select(User).where(User.email == customer_email))
    user = result.scalar_one_or_none()

    if not user:
        logger.warning(f"User not found for email {customer_email}")
        return

    # Get next billing date from current_billing_period
    billing_period = data.get("current_billing_period") or {}
    ends_at = billing_period.get("ends_at")

    user.plan = "pro"
    user.paddle_customer_id = customer_id
    user.paddle_subscription_id = subscription_id

    if ends_at:
        user.plan_expires_at = datetime.fromisoformat(ends_at.replace("Z", "+00:00"))

    await db.commit()
    logger.info(f"Activated Pro for user {customer_email}")


async def handle_subscription_updated(data: dict, db: AsyncSession):
    """Handle subscription updates (renewal, etc.)."""
    subscription_id = data.get("id")
    status = data.get("status")

    result = await db.execute(
        select(User).where(User.paddle_subscription_id == subscription_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        logger.warning(f"User not found for subscription {subscription_id}")
        return

    if status == "active":
        user.plan = "pro"
        billing_period = data.get("current_billing_period") or {}
        ends_at = billing_period.get("ends_at")
        if ends_at:
            user.plan_expires_at = datetime.fromisoformat(ends_at.replace("Z", "+00:00"))
        logger.info(f"Updated subscription for user {user.email}, status: {status}")
    elif status == "canceled":
        # Subscription canceled but may still be active until period ends
        logger.info(f"Subscription canceled for user {user.email}")
    elif status == "past_due":
        logger.warning(f"Subscription past_due for user {user.email}")

    await db.commit()


async def handle_subscription_canceled(data: dict, db: AsyncSession):
    """Handle subscription cancellation (end of billing period)."""
    subscription_id = data.get("id")

    result = await db.execute(
        select(User).where(User.paddle_subscription_id == subscription_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        logger.warning(f"User not found for canceled subscription {subscription_id}")
        return

    user.plan = "free"
    user.paddle_subscription_id = None
    user.plan_expires_at = None
    # Keep paddle_customer_id for potential resubscription

    await db.commit()
    logger.info(f"Subscription ended for user {user.email}")


async def handle_transaction_completed(data: dict, db: AsyncSession):
    """Handle completed transaction (payment success)."""
    # This confirms payment went through
    subscription_id = data.get("subscription_id")
    if not subscription_id:
        return  # One-time purchase, not subscription

    result = await db.execute(
        select(User).where(User.paddle_subscription_id == subscription_id)
    )
    user = result.scalar_one_or_none()

    if user:
        logger.info(f"Payment completed for user {user.email}")
