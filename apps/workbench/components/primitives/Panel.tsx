import type { ReactNode } from "react";
import { cx, ui } from "@/lib/ui-classes";

export interface PanelProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyFlush?: boolean;
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyFlush,
}: PanelProps): ReactNode {
  const hasHead = title !== undefined || actions !== undefined;
  return (
    <section className={cx(ui.panel.root, className)}>
      {hasHead && (
        <header className={ui.panel.head}>
          {title !== undefined && <h3 className={ui.panel.title}>{title}</h3>}
          {actions !== undefined && (
            <div className={ui.panel.actions}>{actions}</div>
          )}
        </header>
      )}
      {description !== undefined && (
        <p className={ui.panel.desc}>{description}</p>
      )}
      <div className={cx(ui.panel.body, bodyFlush && ui.panel.bodyFlush)}>
        {children}
      </div>
    </section>
  );
}
