import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { RightSidebar } from "@/components/layout/right-sidebar";
import { SidebarNav } from "@/components/layout/sidebar-nav";

/**
 * Main app layout — three-column responsive shell
 *
 * Desktop: Left nav (fixed) | Center content (scrollable) | Right sidebar (fixed)
 * Mobile: Single column with bottom nav
 *
 * This layout applies to all authenticated app routes in (main) route group.
 */
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen bg-[rgb(var(--color-bg-primary))]">
      {/* Atmospheric gradient overlay — adds depth to flat black */}
      <div className="pointer-events-none fixed inset-0 bg-gradient-radial from-[rgb(var(--color-brand)/0.03)] via-transparent to-transparent" />

      {/* Three-column layout container */}
      <div className="relative mx-auto flex max-w-[1280px]">
        {/* Left sidebar — navigation */}
        <aside
          className="hidden lg:flex lg:w-[275px] flex-shrink-0"
          aria-label="Primary navigation"
        >
          <div className="fixed top-0 h-screen w-[275px] overflow-y-auto border-r border-[rgb(var(--color-border-primary)/0.3)]">
            <SidebarNav />
          </div>
        </aside>

        {/* Center column — main content */}
        <main className="flex-1 min-w-0 lg:max-w-[600px] border-x border-[rgb(var(--color-border-primary)/0.3)]">
          {children}
        </main>

        {/* Right sidebar — trending, who to follow */}
        <aside
          className="hidden xl:flex xl:w-[350px] flex-shrink-0"
          aria-label="Trending and suggestions"
        >
          <div className="fixed top-0 h-screen w-[350px] overflow-y-auto">
            <RightSidebar />
          </div>
        </aside>
      </div>

      {/* Mobile bottom nav — shown on mobile only */}
      <MobileBottomNav />
    </div>
  );
}
