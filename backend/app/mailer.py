"""Sending email through Resend (https://resend.com)."""

import html
import logging
import secrets
import time
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.config import settings

logger = logging.getLogger("joblogga.mailer")

RESEND_URL = "https://api.resend.com/emails"


@dataclass(frozen=True)
class EmailMessage:
    to: str
    subject: str
    text: str  # plain-text version, for clients that don't show HTML
    html: str


class EmailSendError(RuntimeError):
    pass


class EmailSender(Protocol):
    def send(self, message: EmailMessage) -> None: ...


class ResendSender:
    """Sends through Resend's HTTP API. Failures raise EmailSendError."""

    def __init__(self, api_key: str, from_address: str, client: httpx.Client | None = None, retry_delay: float = 1.0):
        self._api_key = api_key
        self._from = from_address
        self._client = client or httpx.Client(timeout=10.0)
        self._retry_delay = retry_delay

    def send(self, message: EmailMessage) -> None:
        payload = {"from": self._from, "to": [message.to], "subject": message.subject, "html": message.html, "text": message.text}
        # One key per email, reused if we retry: if the first attempt did reach Resend
        # and only the reply was lost, the retry cannot send a second copy.
        headers = {"Authorization": f"Bearer {self._api_key}", "Idempotency-Key": secrets.token_hex(16)}
        last_error = "no response"
        for attempt in (1, 2):
            try:
                response = self._client.post(RESEND_URL, json=payload, headers=headers)
            except httpx.HTTPError as e:
                last_error = type(e).__name__  # never the message: it can contain the request URL and details
            else:
                if response.is_success:
                    return
                last_error = f"HTTP {response.status_code}"
                # 4xx (other than "slow down") means our request is wrong: retrying cannot help.
                if response.status_code < 500 and response.status_code != 429:
                    raise EmailSendError(f"Resend rejected the email: {last_error}")
            if attempt == 1:
                time.sleep(self._retry_delay)
        raise EmailSendError(f"Resend did not accept the email after a retry: {last_error}")


class UnconfiguredSender:
    """Stands in when no API key is set (local development): nothing is sent."""

    def send(self, message: EmailMessage) -> None:
        logger.warning("Email not sent: RESEND_API_KEY is not set.")
        if settings.log_reset_links:
            # Development convenience, off by default: the link in the body is a live password reset.
            logger.warning("DEV ONLY (LOG_RESET_LINKS): email to %s\n%s", message.to, message.text)


def get_email_sender() -> EmailSender:
    if settings.resend_api_key:
        return ResendSender(settings.resend_api_key, settings.email_from)
    return UnconfiguredSender()


def password_reset_message(to: str, link: str, minutes: int) -> EmailMessage:
    safe_link = html.escape(link, quote=True)
    text = (
        "Reset your Joblogga password\n\n"
        "Someone asked to reset the password for this account. To choose a new one, open this link:\n\n"
        f"{link}\n\n"
        f"The link works once and expires in {minutes} minutes.\n\n"
        "If you didn't ask for this, you can ignore this email. Your password has not changed.\n"
    )
    body = f"""<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4efe5;color:#1f2622;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#fffcf6;border:1px solid #d6ccb8;border-radius:2px;padding:28px;">
      <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:600;">Reset your Joblogga password</h1>
      <p style="margin:0 0 20px;line-height:1.5;">Someone asked to reset the password for this account. To choose a new one, use the button below.</p>
      <p style="margin:0 0 24px;"><a href="{safe_link}" style="display:inline-block;background:#2d5b4c;color:#fffcf6;padding:10px 18px;border-radius:4px;text-decoration:none;font-weight:600;">Choose a new password</a></p>
      <p style="margin:0 0 8px;line-height:1.5;color:#565c57;font-size:14px;">The link works once and expires in {minutes} minutes. If the button doesn't work, paste this address into your browser:</p>
      <p style="margin:0 0 20px;word-break:break-all;font-size:13px;color:#565c57;">{safe_link}</p>
      <p style="margin:0;line-height:1.5;color:#565c57;font-size:14px;">If you didn't ask for this, you can ignore this email. Your password has not changed.</p>
    </div>
  </body>
</html>"""
    return EmailMessage(to=to, subject="Reset your Joblogga password", text=text, html=body)
