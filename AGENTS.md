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

## React Compiler

This project uses **React Compiler** (babel-plugin-react-compiler). The compiler automatically memoizes components and values, so:

- **Do NOT use** `useCallback`, `useMemo`, or `React.memo` manually
- Write plain functions and values inline - the compiler handles optimization
- Avoid `useRef` for memoization hacks - just write straightforward code
- Event handlers can be defined inline without performance concerns

## Async/Await

- Handle errors from async operations (that return `Promise`s), DON'T simply `void` the result to silence the lint errors
