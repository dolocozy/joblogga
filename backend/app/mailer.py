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
            # Development convenience, off by default: the links in the body are live.
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


def _card(heading: str, paragraph: str, button: tuple[str, str], notes: list[str], footer: str) -> str:
    """The look shared by the account emails: one sheet on the paper background."""
    label, href = button
    safe_href = html.escape(href, quote=True)
    note_html = "".join(f'<p style="margin:0 0 8px;word-break:break-all;font-size:13px;color:#565c57;">{n}</p>' for n in notes)
    return f"""<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4efe5;color:#1f2622;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#fffcf6;border:1px solid #d6ccb8;border-radius:2px;padding:28px;">
      <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:600;">{html.escape(heading)}</h1>
      <p style="margin:0 0 20px;line-height:1.5;">{html.escape(paragraph)}</p>
      <p style="margin:0 0 24px;"><a href="{safe_href}" style="display:inline-block;background:#2d5b4c;color:#fffcf6;padding:10px 18px;border-radius:4px;text-decoration:none;font-weight:600;">{html.escape(label)}</a></p>
      {note_html}
      <p style="margin:12px 0 0;line-height:1.5;color:#565c57;font-size:14px;">{html.escape(footer)}</p>
    </div>
  </body>
</html>"""


def verification_message(to: str, link: str, hours: int) -> EmailMessage:
    text = (
        "Verify your Joblogga email address\n\n"
        "Thanks for signing up. To confirm this address belongs to you, open this link:\n\n"
        f"{link}\n\n"
        f"The link works once and expires in {hours} hours. Verifying matters most for password resets: "
        "it is how we know a reset link would reach you.\n\n"
        "If you didn't sign up for Joblogga, you can ignore this email.\n"
    )
    body = _card(
        "Verify your email address",
        "Thanks for signing up. Use the button below to confirm this address belongs to you.",
        ("Verify my email", link),
        [f"If the button doesn't work, paste this address into your browser: {html.escape(link, quote=True)}"],
        f"The link works once and expires in {hours} hours. If you didn't sign up for Joblogga, you can ignore this email.",
    )
    return EmailMessage(to=to, subject="Verify your Joblogga email address", text=text, html=body)


def already_registered_message(to: str, login_link: str, reset_link: str) -> EmailMessage:
    """Sent when someone signs up with an address that already has an account.

    The signup screen answers the same way for every address, so this email is where
    the real owner learns what happened, without a stranger being told.
    """
    text = (
        "You already have a Joblogga account\n\n"
        "Someone (probably you) tried to sign up with this address, but it already has an account.\n\n"
        f"Log in: {login_link}\n"
        f"Forgot your password? {reset_link}\n\n"
        "If it wasn't you, you can ignore this email. Nothing has changed.\n"
    )
    body = _card(
        "You already have an account",
        "Someone (probably you) tried to sign up to Joblogga with this address, but it already has an account.",
        ("Log in", login_link),
        [f"Forgot your password? Reset it here: {html.escape(reset_link, quote=True)}"],
        "If it wasn't you, you can ignore this email. Nothing has changed.",
    )
    return EmailMessage(to=to, subject="You already have a Joblogga account", text=text, html=body)
