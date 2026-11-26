import { fileURLToPath } from "node:url"
import express from "express"
import helmet from "helmet"
import { localFlagsmith, readFlagsmithConfig } from "./flagsmith.mjs"
import { registerReviewerRoutes } from "./reviewer.mjs"
import { runRehearsal } from "./rehearsal.mjs"

const app = express()
const flags = await localFlagsmith()
let latest = await runRehearsal(flags)
let refreshed = Date.now()
let active

app.disable("x-powered-by")
app.use(helmet({
  strictTransportSecurity: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'"], imgSrc: ["'self'", "data:"], connectSrc: ["'self'"],
      objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: null,
    },
  },
}))
app.use((request, response, next) => {
  response.set("X-Robots-Tag", "noindex, nofollow")
  if (request.path.startsWith("/api/")) response.set("Cache-Control", "no-store")
  next()
})
app.use("/api/scenarios", express.json({ limit: "1kb" }))
registerReviewerRoutes(app, await readFlagsmithConfig())
app.get("/api/evidence", (_, response) => response.json(latest))
app.post("/api/rehearsal", async (request, response) => {
  if (request.get("X-Rehearsal-Request") !== "run") return response.sendStatus(403)
  try {
    if (!active && Date.now() - refreshed < 2000) return response.json(latest)
    active ??= runRehearsal(flags).then(report => {
      latest = report
      refreshed = Date.now()
      return report
    }).finally(() => { active = undefined })
    return response.json(await active)
  } catch (error) {
    console.error("Sandbox rehearsal failed:", error.message)
    return response.status(503).json({ message: "The local rehearsal couldn't verify both paths. Try again." })
  }
})
app.use("/api", (error, _request, response, _next) => {
  response.status(error.status === 413 ? 413 : 400).json({ message: "Invalid rehearsal request body." })
})
app.use("/api", (_, response) => response.sendStatus(404))
app.use(express.static(fileURLToPath(new URL("../dist/", import.meta.url)), { dotfiles: "deny" }))
app.get(["/checkout", "/presenter", "/shop/:key"], (_, response) => response.sendFile(fileURLToPath(new URL("../dist/index.html", import.meta.url))))
const port = Number(process.env.PORT ?? 4197)
app.listen(port, "127.0.0.1", () => console.log(`Rollback Rehearsal listening on http://127.0.0.1:${port}`))
