/**
 * Flight phase from height above ground (ft), vertical rate (ft/min) and
 * ground speed (kt). See categories.js for what each phase means.
 */
function detectPhase({ aglFt, verticalRate = 0, gs = 0, onGround = false }) {
    const vr = verticalRate || 0;
    if (onGround || aglFt < 50) {
        if (gs > 60) return 'roll';
        if (gs > 4) return 'taxi';
        return 'idle';
    }
    if (aglFt < 3000 && vr > 500) return 'takeoff';
    if (aglFt < 6000 && vr < -300) return 'approach';
    if (vr > 300) return 'climb';
    if (vr < -300) return 'descent';
    return 'level';
}

module.exports = { detectPhase };
