import { IconSparkles } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

export function SiteHeader() {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <span className="text-sm font-medium sm:text-base">Rollback lab</span>
        <Button asChild variant="ghost" size="sm" className="ml-auto min-h-10">
          <a href="#how-it-works"><IconSparkles aria-hidden="true" />How it works</a>
        </Button>
      </div>
    </header>
  )
}
