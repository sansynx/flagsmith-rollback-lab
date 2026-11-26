import { createRoot } from "react-dom/client"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Dashboard } from "@/dashboard"
import { Checkout } from "@/checkout"
import { Presenter } from "@/presenter"
import { Storefront } from "@/storefront"
import "./index.css"

const path = location.pathname.replace(/\/$/, "")
function App() {
  if (path === "/presenter") return <Presenter />
  if (path.startsWith("/shop/")) return <Storefront room={path.slice("/shop/".length)} />
  if (path === "/checkout") return <Checkout />
  return <Dashboard />
}

createRoot(document.getElementById("root")!).render(<TooltipProvider><App /></TooltipProvider>)
