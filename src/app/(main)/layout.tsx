import { Sidebar } from "@/components/Sidebar";
import { RightSidebar } from "@/components/RightSidebar";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex max-w-[1280px] mx-auto min-h-screen">
      {/* Left sidebar */}
      <aside className="w-[68px] xl:w-[275px] shrink-0 sticky top-0 h-screen border-r border-twitter-border">
        <Sidebar />
      </aside>

      {/* Main content */}
      <main className="flex-1 max-w-[600px] border-r border-twitter-border min-h-screen">
        {children}
      </main>

      {/* Right sidebar */}
      <aside className="hidden lg:block w-[350px] shrink-0 px-6">
        <RightSidebar />
      </aside>
    </div>
  );
}
