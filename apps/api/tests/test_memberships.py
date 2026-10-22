from datetime import UTC, datetime, timedelta

import pytest

from app.memberships import evaluate_memberships
from app.models import Membership, MembershipStatus


def membership(start, end, status=MembershipStatus.ACTIVE) -> Membership:
    return Membership(start_at=start, end_at=end, status=status)


@pytest.mark.parametrize(
    ("offset", "status", "allowed", "reason"),
    [
        (0, MembershipStatus.ACTIVE, True, "MEMBERSHIP_ACTIVE"),
        (10, MembershipStatus.SUSPENDED, False, "MEMBERSHIP_SUSPENDED"),
        (10, MembershipStatus.CANCELLED, False, "MEMBER_INACTIVE"),
    ],
)
def test_membership_states(offset, status, allowed, reason):
    start = datetime(2026, 1, 1, tzinfo=UTC)
    item = membership(start, start + timedelta(seconds=20), status)
    result = evaluate_memberships([item], start + timedelta(seconds=offset))
    assert result.allowed is allowed
    assert result.reason_code == reason


def test_membership_end_is_exclusive():
    start = datetime(2026, 1, 1, tzinfo=UTC)
    end = start + timedelta(days=1)
    result = evaluate_memberships([membership(start, end)], end)
    assert not result.allowed
    assert result.reason_code == "MEMBERSHIP_EXPIRED"


def test_future_membership_is_not_started():
    now = datetime(2026, 1, 1, tzinfo=UTC)
    result = evaluate_memberships(
        [membership(now + timedelta(seconds=1), now + timedelta(days=1))], now
    )
    assert result.reason_code == "MEMBERSHIP_NOT_STARTED"
