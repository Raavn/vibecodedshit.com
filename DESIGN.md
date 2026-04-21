---
name: Vibe-Coded Brutalism
colors:
  surface: '#fff7f9'
  surface-dim: '#f8cdf0'
  surface-bright: '#fff7f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#ffeff9'
  surface-container: '#ffe7f8'
  surface-container-high: '#ffdff7'
  surface-container-highest: '#ffd6f7'
  on-surface: '#2c112b'
  on-surface-variant: '#4f434c'
  inverse-surface: '#432641'
  inverse-on-surface: '#ffebf8'
  outline: '#81737c'
  outline-variant: '#d3c2cc'
  surface-tint: '#814c7a'
  primary: '#2b002a'
  on-primary: '#ffffff'
  primary-container: '#441540'
  on-primary-container: '#b77cad'
  inverse-primary: '#f3b2e7'
  secondary: '#7e4d7c'
  on-secondary: '#ffffff'
  secondary-container: '#fec1f8'
  on-secondary-container: '#7b4a79'
  tertiary: '#240923'
  on-tertiary: '#ffffff'
  tertiary-container: '#3b1e39'
  on-tertiary-container: '#aa84a4'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffd7f4'
  primary-fixed-dim: '#f3b2e7'
  on-primary-fixed: '#350733'
  on-primary-fixed-variant: '#673561'
  secondary-fixed: '#ffd6f8'
  secondary-fixed-dim: '#efb3e9'
  on-secondary-fixed: '#330835'
  on-secondary-fixed-variant: '#643663'
  tertiary-fixed: '#ffd6f7'
  tertiary-fixed-dim: '#e4badd'
  on-tertiary-fixed: '#2c112b'
  on-tertiary-fixed-variant: '#5c3c59'
  background: '#fff7f9'
  on-background: '#2c112b'
  surface-variant: '#ffd6f7'
typography:
  display-xl:
    fontFamily: Space Grotesk
    fontSize: 8rem
    fontWeight: '700'
    lineHeight: '0.9'
    letterSpacing: -0.05em
  display-lg:
    fontFamily: Space Grotesk
    fontSize: 5rem
    fontWeight: '700'
    lineHeight: '1.0'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 3rem
    fontWeight: '700'
    lineHeight: '1.2'
  body-lg:
    fontFamily: Space Grotesk
    fontSize: 1.875rem
    fontWeight: '400'
    lineHeight: '1.5'
  body-md:
    fontFamily: Space Grotesk
    fontSize: 1.25rem
    fontWeight: '400'
    lineHeight: '1.6'
  label-mono:
    fontFamily: monospace
    fontSize: 0.875rem
    fontWeight: '400'
    letterSpacing: 0.1em
  label-caps:
    fontFamily: Space Grotesk
    fontSize: 0.875rem
    fontWeight: '700'
    letterSpacing: 0.2em
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  container-max: 1440px
  page-margin: 3rem
  section-gap: 6rem
  stack-gap: 3rem
  element-gap: 1.5rem
---

## Brand & Style
The brand is an editorial-satire platform targeting a design-conscious, environmentally-aware audience. It evokes a sense of "activist elegance"—mixing the raw, unapologetic nature of **Brutalism** with the polished aesthetics of **High-Contrast Minimalism**. 

The UI should feel like a digital broadsheet: authoritative, loud, and intentionally jarring. It uses heavy typography and "redacted" visual motifs to create a sense of urgency. The emotional response is one of critical reflection masked by high-fashion presentation. Key stylistic markers include massive typographic scale, monochrome imagery with grayscale filters, and the use of translucent glass layers to provide modern relief against a heavy, saturated background.

## Colors
The palette is dominated by a high-saturation orchid-mauve (`#CEA5C7`) as the canvas, creating a distinctive and non-standard background. Deep fuchsia and near-black plums (`#2b002a`) provide the primary contrast for text and structural elements. 

- **Primary**: Used for headlines and heavy "REDACTED" blocks.
- **Secondary**: Used for muted accents and container backgrounds.
- **Glass-Surface**: Semi-transparent white layers provide a "modern" lens over the brutalist base.
- **Grayscale Filter**: All imagery should be desaturated to 60-100% to maintain the editorial tone.

## Typography
The system relies exclusively on **Space Grotesk** to bridge the gap between technical precision and bold editorial. 

- **Scale**: The hierarchy is extreme. Display sizes reach 8rem to create a "poster" effect.
- **Styling**: Headlines use tight tracking and leading. 
- **The "Redacted" Style**: Labels for entry numbers and categories use monospaced system fonts to evoke a database or archival feel.
- **Quotes**: Large-scale italicized body text (light weight) is used for pull quotes to break the rhythm of heavy headlines.

## Layout & Spacing
The layout follows a **Fixed Grid** approach with a generous 1440px maximum width and substantial 3rem (48px) side margins. 

- **Rhythm**: Sections are separated by massive 6rem vertical gaps to emphasize content isolation. 
- **Alignment**: Mixed alignment—centered navigation bars contrasted with left-heavy hero sections. 
- **Cards**: Media and text are paired in 50/50 split layouts that alternate orientation (zigzag) to keep the user engaged during long scrolls.

## Elevation & Depth
Depth is achieved through **Glassmorphism** and **Editorial Shadows** rather than standard material elevation.

- **Glass Layers**: The navigation bar and key cards use a 20% white fill with a heavy 20px backdrop blur.
- **Shadows**: Only one shadow style is permitted—the "Editorial Shadow"—which is a very deep, low-opacity (6%) plum-tinted shadow (`rgba(44, 17, 43, 0.06)`) with a large 48px blur.
- **Overlays**: Text overlays (like "REDACTED" banners) use rotation (-12 to 8 degrees) to create a physical, layered paper effect that breaks the digital grid.

## Shapes
The shape language is a high-contrast mix of **Pill-shaped** (Full) and **Soft-Large** (1rem+) corners.

- **Buttons**: Use a `full` roundedness (pill-shape) for a modern, friendly touch.
- **Media Containers**: Use a `DEFAULT` (1rem) or `lg` (2rem) radius to soften the impact of the harsh primary colors.
- **Rotation**: Occasional 5-12 degree rotation on accent elements (tags, banners) adds a DIY/punk aesthetic to the otherwise clean layout.

## Components
- **Buttons**:
  - *Primary*: Pill-shaped, high-contrast fuchsia background, white bold text. Scale down slightly (95%) on hover.
  - *Secondary/Ghost*: No background, bold text with an underline that matches the text color's 30% opacity.
- **Media Cards**:
  - Aspect ratio of 16:9.
  - Grayscale image filter applied by default.
  - Centered "Redacted" banner overlay in primary color with white heavy-weight caps.
- **Navigation Bar**:
  - Fixed position, translucent blur, subtle bottom shadow.
  - Links use 60% opacity with 100% hover states.
- **Data Labels**:
  - Monospaced font, all-caps, with `//` separators for entry details (e.g., `ENTRY #001 // CATEGORY: DESIGN`).
- **Input Fields (implied)**:
  - Should follow the glassmorphic style: semi-transparent white background, 1rem roundedness, and primary-colored focus borders.