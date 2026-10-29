import type { Priority, TaskKind } from "./types";

export interface Candidate {
  id: string;
  title: string;
  kind: TaskKind;
  product: string;
  module: string;
  priority: Priority;
  description: string;
  criteria: string[];
  on: boolean;
}

export const SAMPLE_SOURCE = `产品群里整理的几件事：
1. 支付中心：退款时如果金额超过原订单金额，现在没有拦截，线上有客户遇到了，比较紧急。
2. 企业管理后台的订单列表希望能导出 CSV，导出时带上当前的筛选条件。
3. 移动端 App 下拉刷新后，列表会跳回顶部，用户反馈很烦。
4. 开放平台的 API 密钥想支持设置过期时间，快到期时提醒管理员。`;

