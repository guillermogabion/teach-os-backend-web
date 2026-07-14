import * as licenseService from "@/services/license.service";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly — adjust to taste

/**
 * Starts a recurring sweep that flips any lapsed ACTIVATED/UNUSED
 * licenses to EXPIRED, independent of anyone activating/validating
 * that specific license. Call this once at server startup (e.g. in
 * your index.ts/server.ts right after app.listen), not inside
 * createApp() — createApp() may run more than once in tests.
 */
export function startLicenseExpiryJob() {
    // Run once immediately on boot, then on the interval after that.
    licenseService.checkAndExpireLicenses().catch((err) => {
        console.error("License expiry sweep failed:", err);
    });

    setInterval(() => {
        licenseService.checkAndExpireLicenses().catch((err) => {
            console.error("License expiry sweep failed:", err);
        });
    }, CHECK_INTERVAL_MS);
}