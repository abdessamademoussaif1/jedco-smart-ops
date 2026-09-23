export interface Stats {
    /** Sum of all counts. */
    total: number;
    /** Days in the period. */
    days: number;
    /** Days with at least one contribution. */
    activeDays: number;
    emptyDays: number;
    max: number;
    /** Average per active day. */
    average: number;
    longestStreak: number;
    /** Active days in a row at the end of the period. */
    currentStreak: number;
}

/** Summarizes counts of consecutive days. */
export function summarize(counts: readonly number[]): Stats {
    let total = 0;
    let activeDays = 0;
    let max = 0;
    let longestStreak = 0;
    let streak = 0;

    for (const count of counts) {
        total += count;
        if (count > 0) {
            activeDays++;
            streak++;
            if (streak > longestStreak) longestStreak = streak;
        } else {
            streak = 0;
        }
        if (count > max) max = count;
    }

    return {
        total,
        days: counts.length,
        activeDays,
        emptyDays: counts.length - activeDays,
        max,
        average: activeDays === 0 ? 0 : total / activeDays,
        longestStreak,
        currentStreak: streak
    };
}
