# Rollback Rehearsal

Compare two rollback orders against a real self-hosted Flagsmith flag and a synthetic in-flight session. The verifier requires the same final flag and handler state in both paths.

## Browser walkthrough

1. Choose a scenario. Checkout is the default.
2. Turn the Flagsmith treatment switch on. The app writes the enabled flag to Flagsmith, reads the SDK assignment, and captures one synthetic treatment session.
3. Turn it off. Fresh traffic returns to control. In the original path the active session loses its handler. In the revised path the agent waits for the pending session to complete, then retires the handler.
4. Compare Original plan and Revised plan under Run evidence. Download the result as JSON.

## Two-screen live shop

Open [/presenter](/presenter) and select **Open live shop**. Move the shop into its own window, or copy its paired link to a phone. Switch checkout_v2 on and off on the presenter while the shop is displaying the book. Its purchase flow changes between standard and express automatically.

To demonstrate an in-flight order, switch on, start express checkout in the shop, then turn the flag off on the presenter before payment. New orders use standard checkout. With “Let open orders finish” the open express order succeeds. Repeat with “Retire express checkout immediately” and the open order fails. The store uses test payments. Each presenter gets a separate shop link.

## Shopper checkout

Open [/checkout](/checkout), turn checkout_v2 on, then off, and press Pay. The shopper sees a failed payment. Choose **Retry with protected rollback** to submit the same cart in the verified revised timeline and receive a demo receipt. Paying before rollback also works. Returning to the lab in the same tab preserves the evidence.

The payment endpoint is POST /api/scenarios/checkout/pay. Use the same request headers and sandbox as the toggle. Send capturedAt from the opened session and a plan of live (before rollback), original, or revised (after rollback). Attempts are idempotent per session and plan. Expected payment statuses are 410 for original and 201 for revised.

## API walkthrough

No login or API key is required. The first switch-on response sets a cookie for an isolated sandbox. Preserve that cookie between calls. Sandboxes expire after 20 minutes of inactivity.

- GET /api/scenarios lists six scenario IDs and their expected HTTP outcomes.
- GET /api/session returns the current state for the caller's sandbox.
- POST /api/scenarios/{id}/toggle takes a JSON body with an enabled boolean. Include Content-Type: application/json and X-Rehearsal-Request: run.

Example using a cookie jar from a shell. Set BASE to this site's origin.

    jar=$(mktemp)
    curl -fsS -c "$jar" -b "$jar" -H 'Content-Type: application/json' -H 'X-Rehearsal-Request: run' -d '{"enabled":true}' "$BASE/api/scenarios/checkout/toggle"
    curl -fsS -c "$jar" -b "$jar" -H 'Content-Type: application/json' -H 'X-Rehearsal-Request: run' -d '{"enabled":false}' "$BASE/api/scenarios/checkout/toggle"
    rm -f "$jar"

On the second response, evidence.original.steps ends in HTTP 410, and evidence.revised.steps has HTTP 201 before handler retirement. The captured treatment assignment is retained in the original replay. Fresh visitors get control in both paths.

The planner is bounded to the supplied sandbox workflow. Flagsmith supplies the live assignments. Synthetic HTTP fixtures supply the checkout and other scenario outcomes.
