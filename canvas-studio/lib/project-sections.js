/** 把项目分成「未分组桶 + 各分组段」，悬空 groupId 回落未分组。 */
export function resolveVisibleSections(projects, groups) {
    const known = new Set(groups.map(group => group.id));
    const buckets = new Map();
    for (const group of groups)
        buckets.set(group.id, []);
    const ungrouped = [];
    for (const project of projects) {
        const groupId = project.groupId;
        // 三种都算「没有可归属的分组」：字段缺失、显式归零、指向已删除的分组。
        if (groupId === undefined || groupId === null || !known.has(groupId)) {
            ungrouped.push(project);
            continue;
        }
        // known.has 已保证键存在；取不到就不硬塞 —— 这里不制造第二份归属口径。
        const bucket = buckets.get(groupId);
        if (bucket !== undefined)
            bucket.push(project);
    }
    return {
        ungrouped,
        sections: groups.map(group => ({
            key: group.id,
            title: group.name,
            groupId: group.id,
            items: buckets.get(group.id) ?? [],
        })),
    };
}
