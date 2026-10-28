export const ME = "me";
export const personName = (id: string) => id === ME ? "我" : id || "未指派";
