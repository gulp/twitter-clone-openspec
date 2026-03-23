"use client";

import { cn } from "./utils";

export interface Tab {
  id: string;
  label: string;
  content?: React.ReactNode;
}

export interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onChange, className }: TabsProps) {
  return (
    <div className={cn("w-full", className)}>
      <div className="border-b border-[rgb(var(--color-border-primary))]">
        <nav className="flex -mb-px" role="tablist" aria-label="Tabs">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`panel-${tab.id}`}
                onClick={() => onChange(tab.id)}
                className={cn(
                  "py-4 px-6 text-center border-b-2 font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-brand))] focus:ring-offset-2",
                  isActive
                    ? "border-[rgb(var(--color-brand))] text-[rgb(var(--color-brand))]"
                    : "border-transparent text-[rgb(var(--color-text-tertiary))] hover:text-[rgb(var(--color-text-secondary))] hover:border-[rgb(var(--color-border-secondary))]"
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
      <div
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        className="mt-4"
      >
        {tabs.find((tab) => tab.id === activeTab)?.content}
      </div>
    </div>
  );
}
