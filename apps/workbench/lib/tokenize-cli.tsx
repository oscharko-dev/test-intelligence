import { Fragment, type ReactNode } from "react";
import { ui } from "@/lib/ui-classes";

export function tokenizeCli(source: string): ReactNode[] {
  return source.split("\n").map((line, lineIdx) => {
    const env = line.match(/^([A-Z_][A-Z0-9_]*)=(\S+)\s*(\\?)$/);
    if (env) {
      const [, name, value, cont] = env;
      return (
        <span key={`line-${lineIdx}`} className={ui.token.line}>
          <span className={ui.token.env}>{name}</span>=
          <span className={ui.token.str}>{value}</span>
          {cont ? (
            <Fragment>
              {" "}
              <span className={ui.token.cont}>{"\\"}</span>
            </Fragment>
          ) : null}
        </span>
      );
    }
    const tokens = line.match(/(\s+|--[\w-]+|"[^"]*"|\S+|\\)/g) ?? [line];
    return (
      <span key={`line-${lineIdx}`} className={ui.token.line}>
        {tokens.map((tok, tokIdx) => {
          const key = `t-${lineIdx}-${tokIdx}`;
          if (/^\s+$/.test(tok)) return <Fragment key={key}>{tok}</Fragment>;
          if (tok === "\\")
            return (
              <span key={key} className={ui.token.cont}>
                {tok}
              </span>
            );
          if (tok.startsWith("--"))
            return (
              <span key={key} className={ui.token.flag}>
                {tok}
              </span>
            );
          if (tok.startsWith('"'))
            return (
              <span key={key} className={ui.token.str}>
                {tok}
              </span>
            );
          return (
            <span key={key} className={ui.token.cmd}>
              {tok}
            </span>
          );
        })}
      </span>
    );
  });
}
