# agno

WebGPU-powered film emulation effect processor.

## Stack

- **Vite + React 19** with React Compiler
- **TypeScript** (strict mode, strictTypeChecked ESLint)
- **Tailwind CSS 4** + **DaisyUI**
- **WebGPU/WGSL** for GPU compute shaders

## Project Structure

Organized by feature. Types live next to the code that uses them.

```
src/
├── gpu/           # WebGPU infrastructure (context, general shaders)
│   ├── shaders/   # Shared WGSL shaders (blur, color convert, etc.)
│   └── context.ts # Device/adapter initialization
├── App.tsx        # Main UI
├── index.css      # Tailwind + DaisyUI theme
└── webgpu.d.ts    # navigator.gpu type fix
```

Add feature folders as needed (e.g., `grain/` for grain-specific pipeline + shaders).

## Commands

```sh
pnpm dev      # Start dev server
pnpm build    # Type-check + production build
pnpm lint     # ESLint
pnpm format   # Prettier
```

## Key Files

- [src/index.css](src/index.css) - DaisyUI theme config (oklch colors, radii)

## Notes

- WebGPU types augment `navigator.gpu` as optional (not all browsers support it)
- DaisyUI provides component classes (`btn`, `range`, etc.) - check https://daisyui.com/components/
- Prefer semantic colors (`base-100`, `primary`, `base-content`) over raw Tailwind colors
