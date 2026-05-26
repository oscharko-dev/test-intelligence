import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Play } from "lucide-react";
import { Badge } from "@/components/primitives/Badge";
import { IconButton } from "@/components/primitives/IconButton";
import { MetadataRow } from "@/components/primitives/MetadataRow";
import { Panel } from "@/components/primitives/Panel";
import { SelectField } from "@/components/primitives/SelectField";
import { StatusChip } from "@/components/primitives/StatusChip";
import { Switch } from "@/components/primitives/Switch";
import { Tabs } from "@/components/primitives/Tabs";
import { TextField } from "@/components/primitives/TextField";

describe("Panel", () => {
  it("renders title, description, actions and children", () => {
    render(
      <Panel
        title="LLM gateway"
        description="A description"
        actions={<span data-testid="action">go</span>}
      >
        <p>Body</p>
      </Panel>,
    );
    expect(screen.getByText("LLM gateway")).toBeInTheDocument();
    expect(screen.getByText("A description")).toBeInTheDocument();
    expect(screen.getByTestId("action")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("omits the header when no title or actions", () => {
    const { container } = render(
      <Panel>
        <p>only body</p>
      </Panel>,
    );
    expect(container.querySelector(".panel__head")).toBeNull();
  });
});

describe("Badge", () => {
  it("applies the variant class", () => {
    render(<Badge variant="warn">unsaved</Badge>);
    const el = screen.getByText("unsaved");
    expect(el.className).toContain("warn");
  });
});

describe("StatusChip", () => {
  it("renders the state label and class", () => {
    const { container } = render(<StatusChip state="running" />);
    const chip = container.querySelector(".chip");
    expect(chip?.className).toContain("running");
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("renders the blocked_failure label with middle dot", () => {
    render(<StatusChip state="blocked_failure" />);
    expect(screen.getByText(/blocked·failure/)).toBeInTheDocument();
  });
});

describe("IconButton", () => {
  it("forwards aria-label and click", async () => {
    const onClick = vi.fn();
    render(<IconButton icon={Play} label="Launch" onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "Launch" });
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("reflects pressed state via aria-pressed", () => {
    render(<IconButton icon={Play} label="Toggle" pressed />);
    expect(
      screen.getByRole("button", { name: "Toggle" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Tabs", () => {
  it("calls onChange on click", async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        tabs={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]}
        value="a"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Beta" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("supports arrow-key navigation", async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        tabs={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
          { id: "c", label: "Gamma" },
        ]}
        value="b"
        onChange={onChange}
      />,
    );
    const beta = screen.getByRole("tab", { name: "Beta" });
    beta.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("c");
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  it("renders the count badge when present", () => {
    render(
      <Tabs
        tabs={[{ id: "a", label: "Alpha", count: 3 }]}
        value="a"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

describe("MetadataRow", () => {
  it("renders label and value", () => {
    render(<MetadataRow label="fileKey" value="ABC123" />);
    expect(screen.getByText("fileKey")).toBeInTheDocument();
    expect(screen.getByText("ABC123")).toBeInTheDocument();
  });
});

describe("Switch", () => {
  it("toggles on click", async () => {
    const onChange = vi.fn();
    render(
      <Switch label="Enable visual sidecar" checked={false} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("reflects aria-checked", () => {
    render(
      <Switch label="x" checked onChange={() => undefined} />,
    );
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });
});

describe("TextField", () => {
  it("calls onChange and marks invalid", async () => {
    const onChange = vi.fn();
    render(
      <TextField
        label="Figma URL"
        value=""
        onChange={onChange}
        invalid
        hint="Bad"
        hintVariant="err"
      />,
    );
    const input = screen.getByLabelText("Figma URL");
    expect(input).toHaveAttribute("aria-invalid", "true");
    await userEvent.type(input, "x");
    expect(onChange).toHaveBeenCalled();
  });

  it("marks required visually", () => {
    render(<TextField label="Figma URL" required value="" onChange={() => undefined} />);
    expect(screen.getByText("*")).toBeInTheDocument();
  });
});

describe("SelectField", () => {
  it("propagates the selected value", async () => {
    const onChange = vi.fn();
    render(
      <SelectField
        label="Subdir"
        value="a"
        onChange={onChange}
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("Subdir"), "b");
    expect(onChange).toHaveBeenCalledWith("b");
  });
});
