# Skeleton Loader Usage Guide

## Overview

All loading states across the application use the unified `Skeleton` component from `src/components/ui/skeleton.tsx`.

## Quick Start

```tsx
import { Skeleton } from "@/components/ui/skeleton";

// Default shimmer effect (recommended)
<Skeleton className="h-4 w-32 rounded" />

// Pulse animation variant
<Skeleton variant="pulse" className="h-12 w-12 rounded-full" />

// With explicit dimensions
<Skeleton width={200} height={100} />
```

## Variants

### Shimmer (Default)

The shimmer variant uses a gradient animation defined in `src/app/globals.css`. This is the **recommended** variant for a polished, modern loading experience.

```tsx
<Skeleton className="h-16 w-full" />
```

The shimmer animation:
- Uses CSS variables for theme-aware colors
- Automatically adapts to light/dark mode
- Provides smooth left-to-right gradient sweep
- Animation duration: 1.5s

### Pulse

The pulse variant uses Tailwind's built-in `animate-pulse` utility. Use this for lighter-weight scenarios or when you need a simpler animation.

```tsx
<Skeleton variant="pulse" className="h-16 w-full" />
```

## Common Patterns

### Avatar Skeleton

```tsx
<Skeleton className="h-12 w-12 rounded-full" />
```

### Text Line Skeleton

```tsx
<Skeleton className="h-4 w-32" />
```

### Content Block Skeleton

```tsx
<div className="space-y-3">
  <Skeleton className="h-4 w-full" />
  <Skeleton className="h-4 w-3/4" />
  <Skeleton className="h-4 w-5/6" />
</div>
```

### Tweet Card Skeleton

```tsx
<div className="flex gap-3">
  <Skeleton className="w-12 h-12 rounded-full" />
  <div className="flex-1 space-y-3">
    <Skeleton className="h-4 w-32" />
    <Skeleton className="h-16 w-full" />
    <div className="flex gap-4">
      <Skeleton className="h-4 w-12" />
      <Skeleton className="h-4 w-12" />
      <Skeleton className="h-4 w-12" />
    </div>
  </div>
</div>
```

## Important Rules

### ❌ DO NOT Override Background Color

The shimmer effect includes its own gradient background using CSS variables. Overriding the background color via className will break the visual effect.

```tsx
// ❌ BAD - breaks shimmer animation
<Skeleton className="h-4 w-32 bg-gray-800" />

// ✅ GOOD - uses default shimmer background
<Skeleton className="h-4 w-32" />

// ✅ GOOD - use pulse variant if you need custom bg
<Skeleton variant="pulse" className="h-4 w-32 bg-gray-800/20" />
```

### ✅ Always Include ARIA Attributes

The `Skeleton` component automatically includes:
- `role="status"` - Identifies the element as a status indicator
- `aria-busy="true"` - Indicates content is loading
- `aria-label="Loading"` - Provides accessible label

No additional ARIA attributes are needed when using the component.

## Migration Checklist

When replacing ad-hoc skeleton implementations:

1. Import the Skeleton component:
   ```tsx
   import { Skeleton } from "@/components/ui/skeleton";
   ```

2. Replace inline skeleton divs:
   ```tsx
   // Before
   <div className="h-4 w-32 bg-gray-200 animate-pulse rounded" />

   // After
   <Skeleton className="h-4 w-32" />
   ```

3. Remove manual ARIA attributes (component handles them):
   ```tsx
   // Before
   <div
     className="h-4 w-32 skeleton-shimmer rounded"
     role="status"
     aria-busy="true"
     aria-label="Loading"
   />

   // After
   <Skeleton className="h-4 w-32" />
   ```

4. Remove hardcoded background colors when using shimmer variant.

## CSS Reference

The shimmer animation is defined in `src/app/globals.css`:

```css
.skeleton-shimmer {
  background: linear-gradient(
    90deg,
    rgb(var(--color-bg-tertiary)) 0%,
    rgb(var(--color-bg-secondary)) 50%,
    rgb(var(--color-bg-tertiary)) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
```

## Examples in Codebase

- **Feed loading**: `src/components/feed/feed-list.tsx`
- **Notifications loading**: `src/app/(main)/notifications/page.tsx`
- **Who to Follow**: `src/components/layout/right-sidebar.tsx`
- **Search fallback**: `src/app/(main)/search/page.tsx`
- **Login form**: `src/app/(auth)/login/page.tsx`

## Design Rationale

**Why one pattern?**
- **Visual consistency**: Users see the same loading experience everywhere
- **Maintainability**: Single source of truth for skeleton behavior
- **Accessibility**: Standardized ARIA attributes across all loading states
- **Performance**: Shared CSS animation, no duplicate definitions
- **Developer experience**: Import once, use everywhere

**Why shimmer as default?**
- More polished and modern appearance
- Better perceived performance (motion suggests progress)
- Theme-aware via CSS variables
- Matches contemporary web app standards (Linear, Vercel, etc.)
