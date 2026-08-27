import { forwardRef, type ReactNode, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import {
  Undo2,
  Redo2,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Baseline,
  PaintBucket,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  IndentIncrease,
  IndentDecrease,
  Quote,
  Link2,
  Link2Off,
  Image as ImageIcon,
  Table as TableIcon,
  Eraser,
  ChevronDown,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
  Columns3,
  Rows3,
  Trash2,
} from "lucide-react";
import {
  Button,
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  Input,
} from "../ui/index.js";

const TEXT_COLORS = [
  "#0f172a",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#0ea5e9",
  "#3b82f6",
  "#8b5cf6",
];

interface ToolbarButtonProps {
  active?: boolean;
  disabled?: boolean;
  tooltip: string;
  onClick?: () => void;
  children: ReactNode;
}

const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarButton(
  { active, disabled, tooltip, onClick, children },
  ref,
) {
  return (
    <Button
      ref={ref}
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="sm-icon"
      tooltip={tooltip}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
});

function ToolbarSeparator() {
  return <div className="bg-border mx-1 h-5 w-px shrink-0" />;
}

function LinkControl({ editor, active }: { editor: Editor; active: boolean }) {
  const [url, setUrl] = useState("");

  return (
    <Dropdown
      onOpenChange={(open) => {
        if (open) setUrl((editor.getAttributes("link").href as string | undefined) ?? "");
      }}
    >
      <DropdownTrigger asChild>
        <ToolbarButton tooltip="Link" active={active}>
          <Link2 className="h-4 w-4" />
        </ToolbarButton>
      </DropdownTrigger>
      <DropdownContent align="start" size="auto" className="w-72 space-y-2 p-2">
        <Input
          autoFocus
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <div className="flex justify-end gap-1.5">
          {active && (
            <PopoverPrimitive.Close asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => editor.chain().focus().unsetLink().run()}
              >
                <Link2Off className="h-3.5 w-3.5" /> Remove
              </Button>
            </PopoverPrimitive.Close>
          )}
          <PopoverPrimitive.Close asChild>
            <Button
              type="button"
              size="sm"
              disabled={!url.trim()}
              onClick={() =>
                editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run()
              }
            >
              Apply
            </Button>
          </PopoverPrimitive.Close>
        </div>
      </DropdownContent>
    </Dropdown>
  );
}

function ImageControl({ editor }: { editor: Editor }) {
  return (
    <ToolbarButton
      tooltip="Image"
      onClick={() => editor.chain().focus().insertImagePlaceholder().run()}
    >
      <ImageIcon className="h-4 w-4" />
    </ToolbarButton>
  );
}

function ColorControl({
  tooltip,
  icon,
  setColor,
  unsetColor,
}: {
  tooltip: string;
  icon: ReactNode;
  setColor: (color: string) => void;
  unsetColor: () => void;
}) {
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <ToolbarButton tooltip={tooltip}>{icon}</ToolbarButton>
      </DropdownTrigger>
      <DropdownContent align="start" size="auto" className="w-56 p-2">
        <div className="grid grid-cols-8 gap-1">
          {TEXT_COLORS.map((color) => (
            <PopoverPrimitive.Close asChild key={color}>
              <button
                type="button"
                aria-label={color}
                className="border-border h-5 w-5 rounded-full border"
                style={{ backgroundColor: color }}
                onClick={() => setColor(color)}
              />
            </PopoverPrimitive.Close>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="color"
            defaultValue="#000000"
            onChange={(e) => setColor(e.target.value)}
            className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
          />
          <PopoverPrimitive.Close asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={unsetColor}
            >
              Reset
            </Button>
          </PopoverPrimitive.Close>
        </div>
      </DropdownContent>
    </Dropdown>
  );
}

interface RichTextToolbarProps {
  editor: Editor;
}

export default function RichTextToolbar({ editor }: RichTextToolbarProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      heading1: editor.isActive("heading", { level: 1 }),
      heading2: editor.isActive("heading", { level: 2 }),
      heading3: editor.isActive("heading", { level: 3 }),
      blockquote: editor.isActive("blockquote"),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      alignLeft: editor.isActive({ textAlign: "left" }),
      alignCenter: editor.isActive({ textAlign: "center" }),
      alignRight: editor.isActive({ textAlign: "right" }),
      alignJustify: editor.isActive({ textAlign: "justify" }),
      link: editor.isActive("link"),
      inTable: editor.isActive("table"),
    }),
  });

  const blockLabel = state.heading1
    ? "Heading 1"
    : state.heading2
      ? "Heading 2"
      : state.heading3
        ? "Heading 3"
        : state.blockquote
          ? "Quote"
          : "Paragraph";

  return (
    <div className="border-input bg-muted/40 flex flex-wrap items-center gap-0.5 border-b p-1">
      <ToolbarButton
        tooltip="Undo"
        disabled={!state.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        tooltip="Redo"
        disabled={!state.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      <Dropdown>
        <DropdownTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="gap-1 px-2">
            {blockLabel}
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownTrigger>
        <DropdownContent align="start" size="sm" className="p-1">
          <DropdownItem onClick={() => editor.chain().focus().setParagraph().run()}>
            <Pilcrow className="mr-2 h-3.5 w-3.5" /> Paragraph
          </DropdownItem>
          <DropdownItem onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
            <Heading1 className="mr-2 h-3.5 w-3.5" /> Heading 1
          </DropdownItem>
          <DropdownItem onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 className="mr-2 h-3.5 w-3.5" /> Heading 2
          </DropdownItem>
          <DropdownItem onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
            <Heading3 className="mr-2 h-3.5 w-3.5" /> Heading 3
          </DropdownItem>
          <DropdownItem onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            <Quote className="mr-2 h-3.5 w-3.5" /> Quote
          </DropdownItem>
        </DropdownContent>
      </Dropdown>

      <ToolbarSeparator />

      <ToolbarButton
        tooltip="Bold"
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        tooltip="Italic"
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        tooltip="Underline"
        active={state.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        tooltip="Strikethrough"
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>

      <ColorControl
        tooltip="Text color"
        icon={<Baseline className="h-4 w-4" />}
        setColor={(color) => editor.chain().focus().setColor(color).run()}
        unsetColor={() => editor.chain().focus().unsetColor().run()}
      />
      <ColorControl
        tooltip="Background color"
        icon={<PaintBucket className="h-4 w-4" />}
        setColor={(color) => editor.chain().focus().setBackgroundColor(color).run()}
        unsetColor={() => editor.chain().focus().unsetBackgroundColor().run()}
      />

      <ToolbarSeparator />

      <ToolbarButton
        tooltip="Align left"
        active={state.alignLeft}
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
      >
        <AlignLeft className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        tooltip="Align center"
        active={state.alignCenter}
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
      >
        <AlignCenter className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        tooltip="Align right"
        active={state.alignRight}
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
      >
        <AlignRight className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        tooltip="Justify"
        active={state.alignJustify}
        onClick={() => editor.chain().focus().setTextAlign("justify").run()}
      >
        <AlignJustify className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton
        tooltip="Bullet list"
        active={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        tooltip="Numbered list"
        active={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        tooltip="Decrease indent"
        onClick={() => editor.chain().focus().liftListItem("listItem").run()}
      >
        <IndentDecrease className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        tooltip="Increase indent"
        onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
      >
        <IndentIncrease className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      <LinkControl editor={editor} active={state.link} />
      <ImageControl editor={editor} />
      <ToolbarButton
        tooltip="Insert table"
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
      >
        <TableIcon className="h-4 w-4" />
      </ToolbarButton>

      {state.inTable && (
        <>
          <ToolbarSeparator />
          <ToolbarButton
            tooltip="Add column"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            <Columns3 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            tooltip="Add row"
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            <Rows3 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            tooltip="Delete table"
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            <Trash2 className="h-4 w-4" />
          </ToolbarButton>
        </>
      )}

      <ToolbarSeparator />

      <ToolbarButton
        tooltip="Clear formatting"
        onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
      >
        <Eraser className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}
