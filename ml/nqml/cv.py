"""Python mirror of js/engine/cv.js (used by batch reports and parity tests)."""


def to_decimal(american: float) -> float:
    if abs(american) < 100:
        raise ValueError("invalid American odds")
    return 1 + american / 100 if american > 0 else 1 + 100 / -american


def cv_no_push(p_lower: float, decimal: float) -> float:
    if not 0 <= p_lower <= 1 or decimal <= 1:
        raise ValueError("invalid inputs")
    return 100 * (p_lower * decimal - 1)


def cv_push(p_win_lower: float, p_loss_upper: float, decimal: float) -> float:
    if p_win_lower < 0 or p_loss_upper < 0 or p_win_lower + p_loss_upper > 1 + 1e-12:
        raise ValueError("jointly invalid bounds")
    return 100 * (p_win_lower * (decimal - 1) - p_loss_upper)


def cv_sgp(p_joint_lower: float, combined_american):
    """SGP CV% requires an actual combined quote; returns None otherwise."""
    if combined_american is None:
        return None
    return cv_no_push(p_joint_lower, to_decimal(combined_american))
