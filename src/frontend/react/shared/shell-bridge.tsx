/**
 * Adapters that let React views reuse LifeOS shell controls instead of
 * re-implementing them. Each adapter owns the lifecycle of the legacy DOM it
 * creates and tears it down on unmount.
 */
import {useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type MouseEvent} from 'react';
import {createPortal} from 'react-dom';
import {controlIcon, compactDisclosure, type Disclosure} from '@shell/quiet-controls.js';
import {modal, toast} from '@shell/ui.js';

const iconPaths = new Map<string, string>();
/** Same stroke icon set as the shell; path data comes from quiet-controls.js so the two never drift. */
export function ControlIcon({name}: {name: string}) {
  let d = iconPaths.get(name);
  if (d === undefined) {
    d = controlIcon(name).querySelector('path')?.getAttribute('d') ?? '';
    iconPaths.set(name, d);
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function IconButton({icon, label, onClick}: {icon: string; label: string; onClick: () => void}) {
  return (
    <button type="button" className="quiet icon-button" aria-label={label} title={label} onClick={onClick}>
      <ControlIcon name={icon} />
    </button>
  );
}

/**
 * Hosts a DOM node built by a legacy factory. `display: contents` keeps the
 * node laid out as if it were a direct child of the surrounding flex row.
 */
export function LegacyNode({create}: {create: () => Node}) {
  const host = useRef<HTMLSpanElement>(null);
  const factory = useRef(create);
  useLayoutEffect(() => {
    const node = factory.current();
    host.current!.append(node);
    return () => {
      node.parentNode?.removeChild(node);
    };
  }, []);
  return <span ref={host} className="react-legacy-slot" />;
}

/**
 * The shell's compact popover (hover, focus, portal placement, Escape and
 * outside-click handling) with React-rendered content. Content is portalled
 * into a stable container so it stays live while the popover is open.
 */
export function ShellDisclosure({label, icon, portal = false, className, children}: {
  label: string;
  icon: string;
  portal?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const control = useRef<Disclosure | null>(null);
  const [container] = useState(() => document.createElement('div'));
  container.className = className ?? '';
  useLayoutEffect(() => {
    const disclosure = compactDisclosure({label, icon, portal, content: () => container});
    host.current!.append(disclosure.node);
    control.current = disclosure;
    return () => {
      control.current = null;
      disclosure.destroy();
      disclosure.node.remove();
    };
  }, [label, icon, portal, container]);
  // Re-measure an open portal when its content changes size.
  useEffect(() => control.current?.refresh());
  return (
    <span ref={host} className="react-legacy-slot">
      {createPortal(children, container)}
    </span>
  );
}

export interface DialogApi {
  open(title: string, content: ReactNode): void;
  close(): void;
  /** Render inside the view so dialog content shares React context and state. */
  element: ReactNode;
}

/** Opens React content in the app's single shared <dialog id="dialog">. */
export function useShellDialog(): DialogApi {
  const [current, setCurrent] = useState<{container: HTMLElement; content: ReactNode} | null>(null);
  const open = useCallback((title: string, content: ReactNode) => {
    const container = document.createElement('div');
    modal(title, container, {onclose: () => setCurrent(c => (c?.container === container ? null : c))});
    setCurrent({container, content});
  }, []);
  const close = useCallback(() => {
    const dialog = document.querySelector<HTMLDialogElement>('#dialog');
    if (dialog?.open) dialog.close();
  }, []);
  return {open, close, element: current ? createPortal(current.content, current.container) : null};
}

/**
 * A button that shows "Working…" while its async task runs and reports
 * failures through the shell toast (same behaviour as ui.js `busy`).
 */
export function BusyButton({className, onClick, children}: {
  className?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => Promise<unknown>;
  children: ReactNode;
}) {
  const [working, setWorking] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => void (live.current = false);
  }, []);
  return (
    <button
      type="button"
      className={className}
      disabled={working}
      aria-busy={working || undefined}
      onClick={async event => {
        setWorking(true);
        try {
          await onClick(event);
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error));
        } finally {
          if (live.current) setWorking(false);
        }
      }}
    >
      {working ? <span>Working…</span> : children}
    </button>
  );
}
