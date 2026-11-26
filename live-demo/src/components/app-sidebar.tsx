import type { ComponentProps } from "react"
import { IconDashboard, IconFlag, IconListDetails, IconReport, IconSparkles } from "@tabler/icons-react"

import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"

const items = [
  { title: "Overview", url: "#overview", icon: IconDashboard },
  { title: "How it works", url: "#how-it-works", icon: IconSparkles },
  { title: "Run evidence", url: "#evidence", icon: IconListDetails },
  { title: "Verification", url: "#verify", icon: IconReport },
]

export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  const { setOpenMobile } = useSidebar()
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:p-1.5!">
              <a href="#overview" onClick={() => setOpenMobile(false)}>
                <IconFlag className="size-5!" aria-hidden="true" />
                <span className="text-base font-semibold">Rollback Rehearsal</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map(item => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <a href={item.url} onClick={() => setOpenMobile(false)}>
                      <item.icon aria-hidden="true" /><span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <Badge variant="secondary" className="mx-2 mb-2">Local Flagsmith sandbox</Badge>
      </SidebarFooter>
    </Sidebar>
  )
}
