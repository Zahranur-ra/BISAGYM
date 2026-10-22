from dataclasses import dataclass
from datetime import datetime

from app.database import as_utc
from app.models import Membership, MembershipStatus


@dataclass(frozen=True)
class MembershipDecision:
    allowed: bool
    reason_code: str
    membership: Membership | None


def evaluate_memberships(memberships: list[Membership], now: datetime) -> MembershipDecision:
    now = as_utc(now)
    non_cancelled = [m for m in memberships if m.status != MembershipStatus.CANCELLED]
    suspended = [m for m in non_cancelled if m.status == MembershipStatus.SUSPENDED]
    if suspended:
        return MembershipDecision(False, "MEMBERSHIP_SUSPENDED", suspended[0])

    usable = [
        m for m in non_cancelled if m.status in {MembershipStatus.ACTIVE, MembershipStatus.PENDING}
    ]
    current = [m for m in usable if as_utc(m.start_at) <= now < as_utc(m.end_at)]
    if current:
        return MembershipDecision(True, "MEMBERSHIP_ACTIVE", max(current, key=lambda m: m.end_at))
    future = [m for m in usable if now < as_utc(m.start_at)]
    if future:
        return MembershipDecision(
            False, "MEMBERSHIP_NOT_STARTED", min(future, key=lambda m: m.start_at)
        )
    past = [m for m in non_cancelled if now >= as_utc(m.end_at)]
    if past:
        return MembershipDecision(False, "MEMBERSHIP_EXPIRED", max(past, key=lambda m: m.end_at))
    return MembershipDecision(False, "MEMBER_INACTIVE", None)
