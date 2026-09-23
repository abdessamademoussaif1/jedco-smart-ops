import { type Day, dayFromYmd, formatDay } from "../core/dates.ts";
import { GitHubError } from "../errors.ts";
import type { GitHubClient } from "./client.ts";

const QUERY = `query ($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
  }
}`;

interface CalendarResponse {
    user: {
        contributionsCollection: {
            contributionCalendar: {
                weeks: Array<{
                    contributionDays: Array<{ date: string; contributionCount: number }>;
                }>;
            };
        };
    } | null;
}

/** GitHub only accepts ranges of up to one year per query. */
const CHUNK_DAYS = 365;

/**
 * Reads the contribution calendar of `login` between two days (inclusive), as
 * GitHub reports it. Long ranges are fetched one year at a time.
 */
export async function fetchContributions(
    client: GitHubClient,
    login: string,
    from: Day,
    to: Day
): Promise<Map<Day, number>> {
    const counts = new Map<Day, number>();
    for (let start = from; start <= to; start += CHUNK_DAYS) {
        const end = Math.min(to, start + CHUNK_DAYS - 1);
        const data = await client.graphql<CalendarResponse>(QUERY, {
            login,
            from: `${formatDay(start)}T00:00:00Z`,
            to: `${formatDay(end)}T23:59:59Z`
        });
        if (!data.user) throw new GitHubError(`The GitHub user "${login}" doesn't exist.`);

        for (const week of data.user.contributionsCollection.contributionCalendar.weeks) {
            for (const entry of week.contributionDays) {
                const [year, month, day] = entry.date.split("-").map(Number);
                const value = dayFromYmd(year ?? 1970, month ?? 1, day ?? 1);
                if (value >= start && value <= end) counts.set(value, entry.contributionCount);
            }
        }
    }
    return counts;
}
