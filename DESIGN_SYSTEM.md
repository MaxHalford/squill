# Squill Design System

A semantic, component-oriented design system for consistent UI development.

## Philosophy

This design system follows these principles:

1. **Semantic naming** - Variables describe their purpose, not just their visual properties
2. **Component tokens** - High-level tokens for specific components
3. **Consistent scale** - All values follow logical, related scales
4. **Progressive enhancement** - Legacy aliases allow gradual migration

## Typography

### Font Families

- `--font-family-ui` - System UI font for interface elements
- `--font-family-mono` - Monospace font for code, data, and results

### Font Sizes

Based on a modular scale with 14px as the base:

- `--font-size-caption` (11px) - Captions, metadata, timestamps
- `--font-size-body-sm` (12px) - Small body text, table data
- `--font-size-body` (14px) - Default body text, buttons
- `--font-size-body-lg` (16px) - Large body text, emphasis
- `--font-size-heading` (18px) - Headings, modal titles

### Line Heights

- `--line-height-tight` (1.2) - Headings, compact UI elements
- `--line-height-normal` (1.5) - Default for body text
- `--line-height-relaxed` (1.75) - Comfortable reading experiences

## Colors

### Surface Colors

Background colors for different elevation levels:

- `--surface-primary` - Main background (white)
- `--surface-secondary` - Subtle backgrounds, hover states (#f9fafb)
- `--surface-tertiary` - Deeper backgrounds, active states (#e8e8e8)
- `--surface-inverse` - Inverse backgrounds like headers (black)

### Text Colors

- `--text-primary` - Primary text (black)
- `--text-secondary` - Secondary text, metadata (#6b7280)
- `--text-tertiary` - Disabled, placeholder text (#9ca3af)
- `--text-inverse` - Text on dark backgrounds (white)

### Border Colors

- `--border-primary` - Primary borders, dividers (black)
- `--border-secondary` - Subtle borders (#d1d5db)
- `--border-error` - Error state borders (#c62828)

### Semantic Colors

- `--color-accent` - Accent color (#42b883)
- `--color-error` - Error states (#c62828)
- `--color-error-bg` - Error backgrounds (#ffebee)
- `--color-success` - Success states (#10b981)
- `--color-warning` - Warning states (#f59e0b)

## Spacing

All spacing follows a 4px base unit:

- `--space-1` (4px) - Tight spacing between related items
- `--space-2` (8px) - Small gaps, compact padding
- `--space-3` (12px) - Default padding, comfortable gaps
- `--space-4` (16px) - Generous padding, section spacing
- `--space-5` (20px) - Large spacing, modal padding
- `--space-6` (24px) - XL spacing, major sections
- `--space-8` (32px) - XXL spacing, page-level gaps

## Borders

### Border Widths

- `--border-width-thin` (1.5px) - Subtle dividers, inputs
- `--border-width-thick` (2px) - Prominent borders, box outlines

### Border Radius

- `--border-radius-none` (0) - Sharp corners (current style)
- `--border-radius-sm` (2px) - Subtle rounding
- `--border-radius-md` (4px) - Default rounding
- `--border-radius-lg` (8px) - Generous rounding

## Shadows

Flat shadows with offset for depth:

- `--shadow-sm` - Subtle elevation (2px offset)
- `--shadow-md` - Default elevation (6px offset)
- `--shadow-lg` - Prominent elevation (8px offset)

## Component Tokens

High-level semantic tokens for specific components.

### Box/Window

```css
--box-border-width
--box-border-color
--box-border-radius
--box-shadow
--box-shadow-selected
--box-header-bg
--box-header-text
--box-header-padding
```

### Button

```css
--button-padding
--button-border-width
--button-border-radius
--button-font-size
```

### Input

```css
--input-padding
--input-border-width
--input-border-radius
--input-font-size
```

### Table

```css
--table-cell-padding
--table-border-width
--table-font-size
--table-row-hover-bg
--table-row-stripe-bg
```

### Menu/Sidebar

```css
--menu-border-width
--menu-item-padding
--menu-section-padding
```

## Usage Guidelines

### Prefer Semantic Tokens

✅ **Good:**
```css
.button {
  padding: var(--button-padding);
  border: var(--button-border-width) solid var(--border-primary);
  font-size: var(--button-font-size);
}
```

❌ **Avoid:**
```css
.button {
  padding: 4px 12px;
  border: 1.5px solid black;
  font-size: 14px;
}
```

### Use Component Tokens When Available

✅ **Good:**
```css
.custom-button {
  padding: var(--button-padding);
  background: var(--surface-primary);
}
```

❌ **Avoid:**
```css
.custom-button {
  padding: var(--space-1) var(--space-3);
  background: white;
}
```

### Spacing Consistency

Use the spacing scale for all margins, padding, and gaps:

```css
.card {
  padding: var(--space-3);        /* Default padding */
  margin-bottom: var(--space-4);  /* Section spacing */
  gap: var(--space-2);            /* Small gaps */
}
```

## Migration from Legacy Variables

Legacy variables are aliased to the new semantic tokens:

- `--font-ui` → `--font-family-ui`
- `--bg-primary` → `--surface-primary`
- `--border-slim` → `--border-width-thin`
- `--spacing-md` → `--space-3`
- `--font-size-base` → `--font-size-body`

You can gradually migrate to the new tokens at your own pace.

## Examples

### Creating a Card Component

```css
.card {
  background: var(--surface-primary);
  border: var(--border-width-thin) solid var(--border-primary);
  border-radius: var(--border-radius-md);
  padding: var(--space-4);
  box-shadow: var(--shadow-md);
}

.card-title {
  font-size: var(--font-size-heading);
  color: var(--text-primary);
  margin-bottom: var(--space-2);
}

.card-description {
  font-size: var(--font-size-body);
  color: var(--text-secondary);
  line-height: var(--line-height-normal);
}
```

### Creating a Button

```css
.button {
  padding: var(--button-padding);
  border: var(--button-border-width) solid var(--border-primary);
  border-radius: var(--button-border-radius);
  font-size: var(--button-font-size);
  font-family: var(--font-family-ui);
  background: var(--surface-primary);
  color: var(--text-primary);
}

.button:hover {
  background: var(--surface-secondary);
}

.button:disabled {
  background: var(--surface-secondary);
  color: var(--text-tertiary);
}
```
