"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Drawer } from "vaul";
import { Icon, IconName } from "./icons";

export type NavItem = { key: string; label: string; icon: IconName; href?: string };
export type NavGroup = { label: string; items: NavItem[] };

const MORE = "__more";

// The nav is drawn twice: the plain list, and an "active" copy laid exactly on
// top of it, clipped down to the active item's rectangle. Changing the active
// item moves the clip, so the highlight slides there — across groups too — and
// its label turns dark at exactly the same moment, because the colour change
// is the same reveal rather than a second, separately-timed transition.
function ClipNav({
  groups,
  activeKey,
  onSelect,
  radius,
}: {
  groups: NavGroup[];
  activeKey: string | null;
  onSelect: (item: NavItem) => void;
  radius: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const [clip, setClip] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const el = activeKey ? itemRefs.current.get(activeKey) : null;
    if (!wrap) return;
    if (!el) {
      setClip("inset(50% 50% 50% 50%)");
      return;
    }
    const w = wrap.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const top = r.top - w.top;
    const left = r.left - w.left;
    const right = w.right - r.right;
    const bottom = w.bottom - r.bottom;
    setClip(`inset(${top}px ${right}px ${bottom}px ${left}px round ${radius}px)`);
  }, [activeKey, radius]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  // Only animate once the first position is painted, so the highlight doesn't
  // sweep in from nowhere on page load.
  useLayoutEffect(() => {
    if (clip === null || ready) return;
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [clip, ready]);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [measure]);

  const render = (copy: boolean) =>
    groups.map((g, gi) => (
      <div className="nav-group" key={g.label || gi}>
        {g.label && <p className="nav-group-label">{g.label}</p>}
        <ul className="nav-items">
          {g.items.map((item) => {
            const active = item.key === activeKey;
            const ref = copy
              ? undefined
              : (el: HTMLElement | null) => {
                  if (el) itemRefs.current.set(item.key, el);
                  else itemRefs.current.delete(item.key);
                };
            const inner = (
              <>
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </>
            );
            return (
              <li key={item.key}>
                {item.href ? (
                  <a
                    ref={ref}
                    href={item.href}
                    className="nav-item"
                    tabIndex={copy ? -1 : undefined}
                    aria-current={!copy && active ? "page" : undefined}
                  >
                    {inner}
                  </a>
                ) : (
                  <button
                    ref={ref}
                    type="button"
                    className="nav-item"
                    tabIndex={copy ? -1 : undefined}
                    aria-current={!copy && active ? "page" : undefined}
                    aria-haspopup={item.key === MORE ? "dialog" : undefined}
                    onClick={copy ? undefined : () => onSelect(item)}
                  >
                    {inner}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    ));

  return (
    <div className="nav-list" ref={wrapRef}>
      {render(false)}
      <div
        className="nav-active-copy"
        aria-hidden="true"
        data-ready={ready}
        style={{ "--clip": clip ?? "inset(50% 50% 50% 50%)" } as React.CSSProperties}
      >
        {render(true)}
      </div>
    </div>
  );
}

export function Sidebar({
  groups,
  activeKey,
  onSelect,
  top,
  foot,
}: {
  groups: NavGroup[];
  activeKey: string;
  onSelect: (item: NavItem) => void;
  top: React.ReactNode;
  foot: React.ReactNode;
}) {
  return (
    <aside className="sidebar">
      {top}
      <nav aria-label="Sections">
        <ClipNav groups={groups} activeKey={activeKey} onSelect={onSelect} radius={12} />
      </nav>
      {foot}
    </aside>
  );
}

// Phones: up to four sections in a thumb-reachable bar; everything else lives
// in a "More" sheet that slides up from the bar and can be flicked away.
export function BottomBar({
  groups,
  primary,
  activeKey,
  onSelect,
  sheetExtra,
}: {
  groups: NavGroup[];
  primary: NavItem[];
  activeKey: string;
  onSelect: (item: NavItem) => void;
  sheetExtra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const all = groups.flatMap((g) => g.items);
  const needsMore = all.length > primary.length;
  const barItems: NavItem[] = needsMore ? [...primary, { key: MORE, label: "More", icon: "More" }] : primary;
  const barActive = primary.some((i) => i.key === activeKey) ? activeKey : needsMore ? MORE : null;

  return (
    <>
      <nav className="bottombar" aria-label="Sections">
        <div className="bottombar-inner">
          <ClipNav
            groups={[{ label: "", items: barItems }]}
            activeKey={barActive}
            radius={18}
            onSelect={(item) => (item.key === MORE ? setOpen(true) : onSelect(item))}
          />
        </div>
      </nav>

      {needsMore && (
        <Drawer.Root open={open} onOpenChange={setOpen}>
          <Drawer.Portal>
            <Drawer.Overlay className="sheet-overlay" />
            <Drawer.Content className="sheet" aria-describedby={undefined}>
              <div className="sheet-handle" aria-hidden="true" />
              <Drawer.Title className="nav-group-label" style={{ textAlign: "center", marginBottom: 10 }}>
                All sections
              </Drawer.Title>
              <div className="sheet-body">
                {groups.map((g) => (
                  <div className="nav-group" key={g.label}>
                    <p className="nav-group-label">{g.label}</p>
                    <ul className="nav-items">
                      {g.items.map((item) => (
                        <li key={item.key}>
                          {item.href ? (
                            <a href={item.href} className="nav-item">
                              <Icon name={item.icon} />
                              <span>{item.label}</span>
                            </a>
                          ) : (
                            <button
                              type="button"
                              className="nav-item"
                              aria-current={item.key === activeKey ? "page" : undefined}
                              onClick={() => {
                                onSelect(item);
                                setOpen(false);
                              }}
                            >
                              <Icon name={item.icon} />
                              <span>{item.label}</span>
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {sheetExtra}
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      )}
    </>
  );
}
