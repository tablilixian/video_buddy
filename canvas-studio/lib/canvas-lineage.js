/**
 * 计算选中集的血缘聚光。
 *
 * 为什么「没有血缘就不压暗」：压暗是一种**对比手段** —— 它的作用是把血缘
 * 从背景里显出来。选中一张孤立节点（既没引用谁、也没被谁引用）时，压暗只
 * 会把整屏压灰而**揭示不了任何关系**，用户看到的是"画面突然变暗"。故此处
 * 只在「确有血缘可看」时置 active。这条规则同时挡住了最刺眼的场景：刚导入
 * 素材、还没连线时随手点一下卡片，全屏变灰。
 *
 * @param nodes 画布上的全部节点（调用方传可见节点；隐藏节点不参与，否则
 *              会点亮画布上根本看不见的节点 id）。
 * @param selectedIds 当前选中集。
 */
export function canvasSpotlight(nodes, selectedIds) {
    const present = new Set(nodes.map(node => node.id));
    const selected = new Set(selectedIds.filter(id => present.has(id)));
    const lit = new Set(selected);
    if (selected.size === 0)
        return { active: false, lit };
    for (const node of nodes) {
        // 上游：我引用的（node 是选中项 → 它的 sourceIds 一并点亮）。
        if (selected.has(node.id)) {
            for (const sourceId of node.sourceIds) {
                if (present.has(sourceId))
                    lit.add(sourceId);
            }
            continue;
        }
        // 下游：引用我的（node 的 sourceIds 命中任一选中项 → node 一并点亮）。
        if (node.sourceIds.some(sourceId => selected.has(sourceId)))
            lit.add(node.id);
    }
    // lit.size === selected.size ⇒ 选中项的上下游都是空的，没有关系可揭示。
    return { active: lit.size > selected.size, lit };
}
