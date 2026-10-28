import { useApp } from "@/store/state";
import { closeConfirm, setShortcuts } from "@/store/actions";
import { Modal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

export function ConfirmHost() {
  const c = useApp((s) => s.confirm);
  return (
    <Modal
      open={!!c}
      onClose={closeConfirm}
      title={c?.title}
      description={c?.desc}
      size="sm"
      hideClose
      footer={
        <>
          <Button variant="secondary" onClick={closeConfirm}>取消</Button>
          <Button
            variant={c?.danger ? "danger" : "primary"}
            onClick={() => {
              const run = c?.onConfirm;
              closeConfirm();
              run?.();
            }}
          >
            {c?.confirmLabel}
          </Button>
        </>
      }
    />
  );
}

export const GROUPS: { title: string; rows: [string, string[]][] }[] = [
  {
    title: "全局",
    rows: [
      ["命令面板", ["mod", "K"]],
      ["收起 / 展开侧边栏", ["mod", "B"]],
      ["打开设置", ["mod", ","]],
      ["显示快捷键", ["?"]],
    ],
  },
  {
    title: "任务",
    rows: [
      ["下一个任务", ["J"]],
      ["上一个任务", ["K"]],
      ["执行 / 变更 / 禅道原文", ["1", "2", "3"]],
      ["发送追加指令", ["enter"]],
      ["指令输入框内换行", ["shift", "enter"]],
    ],
  },
];

export function ShortcutsDialog() {
  const open = useApp((s) => s.shortcutsOpen);
  return (
    <Modal open={open} onClose={() => setShortcuts(false)} title="键盘快捷键" size="md">
      <div className="space-y-5">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-xs font-medium text-subtle-foreground">{g.title}</h3>
            <ul className="divide-y divide-border">
              {g.rows.map(([label, keys]) => (
                <li key={label} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-foreground">{label}</span>
                  <Kbd keys={keys} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
