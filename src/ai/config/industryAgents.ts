/**
 * Industry-specific Agent configurations.
 *
 * Each industry config provides:
 * - Prompt augmentations for editor/flow agents
 * - Industry-specific tool bindings
 * - Template data for quick generation
 * - Validation rules specific to the domain
 */

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

export type IndustryType = 'medical' | 'finance' | 'education'

export interface IndustryTemplate {
  id: string
  name: string
  description: string
  type: 'form' | 'flow'
  /** Widget nodes or flow graph structure (stored as JSON) */
  schema: Record<string, unknown>[]
}

export interface IndustryConfig {
  name: string
  description: string
  /** Additional system prompt appended to editor agent when industry is active */
  editorPromptAddon: string
  /** Additional system prompt appended to flow agent when industry is active */
  flowPromptAddon: string
  /** Additional system prompt for thinker/router when industry is active */
  thinkerPromptAddon: string
  /** Industry-specific tools available to agents */
  toolNames: string[]
  /** Pre-built templates for the industry */
  templates: IndustryTemplate[]
}

// ────────────────────────────────────────────
// Industry configurations
// ────────────────────────────────────────────

export const industryConfigs: Record<IndustryType, IndustryConfig> = {
  medical: {
    name: '医疗行业',
    description: '专注于医疗行业的表单和流程生成',
    editorPromptAddon: `## 医疗行业特殊要求

你正在为医疗行业生成表单/页面，请遵循以下规范：

1. **专业术语**：使用医疗行业标准术语（如：主诉、现病史、既往史、体格检查、诊断、处方等）
2. **隐私保护**：涉及患者信息的字段必须标注为敏感字段，建议使用脱敏展示
3. **规范合规**：
   - 电子病历需符合《电子病历基本规范》
   - 处方需包含药品通用名、剂量、用法用量
   - 检验检查单需包含标本类型、参考范围
4. **常用表单场景**：
   - 门诊病历（主诉、现病史、查体、诊断、处理）
   - 住院病案首页
   - 护理记录单
   - 手术同意书 / 知情同意书
   - 检验申请单 / 检查申请单
   - 处方笺
   - 出院小结
5. **字段设计**：
   - 诊断字段建议使用 ICD-10 编码选择器
   - 药品字段建议关联药品字典
   - 日期时间字段精确到分钟
   - 生命体征字段使用合适的数值范围校验`,
    flowPromptAddon: `## 医疗行业流程特殊要求

你正在为医疗行业生成流程，请遵循以下规范：

1. **常见医疗流程**：
   - 门诊就诊流程（挂号 → 就诊 → 检查 → 诊断 → 取药）
   - 住院流程（入院申请 → 入院登记 → 检查治疗 → 出院）
   - 会诊流程（申请 → 科室分配 → 会诊 → 反馈）
   - 手术审批流程（申请 → 术前评估 → 审批 → 执行 → 术后记录）
   - 转科/转院流程
   - 药品申领/调剂流程
2. **合规要求**：
   - 关键环节需有双人确认（如手术、输血）
   - 涉及特殊药品需增加审批节点
   - 知情同意环节不可省略
3. **节点设计**：
   - 使用用户任务节点处理人工审核
   - 使用服务任务节点处理系统自动操作
   - 条件分支根据病情严重程度分流
   - 并行网关用于同时进行的检查项目`,
    thinkerPromptAddon: `当用户需求涉及医疗场景时，优先识别以下关键词并路由到对应领域：
- 病历、病案、处方、诊断、检验、检查、护理、手术、住院、门诊、会诊
- 医疗流程通常同时需要表单和流程（chain 模式）`,
    toolNames: ['search_medical_templates', 'validate_medical_form'],
    templates: [
      {
        id: 'medical-outpatient-record',
        name: '门诊病历',
        description: '标准门诊病历模板，包含主诉、现病史、查体、诊断等',
        type: 'form',
        schema: [
          {
            id: 'card-1',
            type: 'card',
            props: { title: '患者基本信息', bordered: true },
            children: [
              { id: 'input-name', type: 'input', props: { label: '姓名', field: 'patientName', required: true, placeholder: '请输入患者姓名' } },
              { id: 'select-gender', type: 'select', props: { label: '性别', field: 'gender', required: true, options: [{ label: '男', value: 'male' }, { label: '女', value: 'female' }] } },
              { id: 'input-age', type: 'number', props: { label: '年龄', field: 'age', required: true, min: 0, max: 150 } },
              { id: 'input-id', type: 'input', props: { label: '身份证号', field: 'idCard', required: true, sensitive: true } },
              { id: 'input-phone', type: 'input', props: { label: '联系电话', field: 'phone', sensitive: true } },
            ],
          },
          {
            id: 'card-2',
            type: 'card',
            props: { title: '就诊信息', bordered: true },
            children: [
              { id: 'date-visit', type: 'datePicker', props: { label: '就诊日期', field: 'visitDate', required: true, defaultValue: '{{today}}' } },
              { id: 'select-dept', type: 'select', props: { label: '就诊科室', field: 'department', required: true, options: [{ label: '内科', value: 'internal' }, { label: '外科', value: 'surgery' }, { label: '妇产科', value: 'obgyn' }, { label: '儿科', value: 'pediatrics' }] } },
              { id: 'input-chief', type: 'input', props: { label: '主诉', field: 'chiefComplaint', required: true, placeholder: '简要描述主要症状及持续时间' } },
              { id: 'textarea-hpi', type: 'textarea', props: { label: '现病史', field: 'historyOfPresentIllness', rows: 4, placeholder: '详细描述本次发病经过' } },
              { id: 'textarea-past', type: 'textarea', props: { label: '既往史', field: 'pastMedicalHistory', rows: 3 } },
              { id: 'textarea-allergy', type: 'textarea', props: { label: '过敏史', field: 'allergyHistory', rows: 2 } },
            ],
          },
          {
            id: 'card-3',
            type: 'card',
            props: { title: '查体与诊断', bordered: true },
            children: [
              { id: 'textarea-pe', type: 'textarea', props: { label: '体格检查', field: 'physicalExamination', rows: 4 } },
              { id: 'input-diagnosis', type: 'input', props: { label: '初步诊断', field: 'diagnosis', required: true } },
              { id: 'textarea-treatment', type: 'textarea', props: { label: '处理意见', field: 'treatmentPlan', rows: 3 } },
            ],
          },
        ],
      },
      {
        id: 'medical-prescription',
        name: '处方笺',
        description: '标准处方模板，包含患者信息、药品列表、用法用量',
        type: 'form',
        schema: [
          {
            id: 'card-1',
            type: 'card',
            props: { title: '处方信息', bordered: true },
            children: [
              { id: 'input-name', type: 'input', props: { label: '患者姓名', field: 'patientName', required: true } },
              { id: 'input-age', type: 'number', props: { label: '年龄', field: 'age', required: true } },
              { id: 'input-weight', type: 'number', props: { label: '体重(kg)', field: 'weight' } },
              { id: 'date-prescription', type: 'datePicker', props: { label: '处方日期', field: 'prescriptionDate', required: true } },
              { id: 'select-type', type: 'select', props: { label: '处方类型', field: 'prescriptionType', options: [{ label: '普通处方', value: 'normal' }, { label: '急诊处方', value: 'emergency' }, { label: '儿科处方', value: 'pediatric' }] } },
            ],
          },
          {
            id: 'card-2',
            type: 'card',
            props: { title: '药品列表', bordered: true },
            children: [
              {
                id: 'table-medicines',
                type: 'table',
                props: {
                  label: '药品明细',
                  field: 'medicines',
                  columns: [
                    { title: '药品名称(通用名)', field: 'drugName', required: true },
                    { title: '规格', field: 'specification' },
                    { title: '数量', field: 'quantity', type: 'number' },
                    { title: '用法', field: 'usage', required: true },
                    { title: '用量', field: 'dosage', required: true },
                    { title: '频次', field: 'frequency', required: true },
                  ],
                },
              },
            ],
          },
          {
            id: 'card-3',
            type: 'card',
            props: { title: '其他', bordered: true },
            children: [
              { id: 'textarea-notes', type: 'textarea', props: { label: '医嘱', field: 'doctorNotes', rows: 3 } },
              { id: 'input-doctor', type: 'input', props: { label: '处方医师', field: 'doctorName', required: true } },
            ],
          },
        ],
      },
      {
        id: 'medical-surgery-approval',
        name: '手术审批流程',
        description: '标准手术审批流程，含术前评估、多级审批、术后记录',
        type: 'flow',
        schema: [
          { id: 'start', type: 'startEvent', data: { bpmnType: 'startEvent', label: '发起手术申请' } },
          { id: 'apply', type: 'userTask', data: { bpmnType: 'userTask', label: '填写手术申请单', assignee: 'surgeon' } },
          { id: 'pre-assess', type: 'userTask', data: { bpmnType: 'userTask', label: '术前评估', assignee: 'anesthesiologist' } },
          { id: 'gateway-risk', type: 'exclusiveGateway', data: { bpmnType: 'exclusiveGateway', label: '风险等级判断' } },
          { id: 'dept-approve', type: 'userTask', data: { bpmnType: 'userTask', label: '科室主任审批', assignee: 'deptDirector' } },
          { id: 'hospital-approve', type: 'userTask', data: { bpmnType: 'userTask', label: '医务部审批', assignee: 'medicalDept' } },
          { id: 'notify', type: 'serviceTask', data: { bpmnType: 'serviceTask', label: '通知手术室' } },
          { id: 'surgery', type: 'userTask', data: { bpmnType: 'userTask', label: '执行手术', assignee: 'surgeon' } },
          { id: 'post-record', type: 'userTask', data: { bpmnType: 'userTask', label: '术后记录', assignee: 'surgeon' } },
          { id: 'end', type: 'endEvent', data: { bpmnType: 'endEvent', label: '流程结束' } },
        ],
      },
    ],
  },

  finance: {
    name: '金融行业',
    description: '专注于金融行业的表单和流程生成',
    editorPromptAddon: `## 金融行业特殊要求

你正在为金融行业生成表单/页面，请遵循以下规范：

1. **专业术语**：使用金融行业标准术语（如：年化收益率、风险评级、资产净值、杠杆率等）
2. **合规要求**：
   - 涉及客户信息需符合《个人信息保护法》
   - 理财产品需标注风险等级
   - 贷款相关需展示年化利率（非日利率/月利率）
   - 投资者适当性管理相关字段
3. **数据精度**：金额字段保留 2 位小数，百分比字段保留 4 位小数
4. **常用表单场景**：
   - 开户申请表（个人/企业）
   - 贷款申请表（房贷、车贷、信用贷、经营贷）
   - 理财产品购买申请
   - 信用卡申请表
   - 保险投保单
   - 风险评估问卷
   - 转账/汇款申请
   - 征信授权书
5. **字段设计**：
   - 金额字段使用千分位格式化
   - 证件号码需输入校验
   - 手机号需验证格式
   - 年收入字段使用区间选择`,
    flowPromptAddon: `## 金融行业流程特殊要求

你正在为金融行业生成流程，请遵循以下规范：

1. **常见金融流程**：
   - 贷款审批流程（申请 → 初审 → 复审 → 终审 → 放款）
   - 开户审核流程
   - 理财产品销售流程（风险评估 → 产品匹配 → 签约 → 确认）
   - 信用卡审批流程
   - 理赔流程（报案 → 查勘 → 定损 → 审核 → 赔付）
   - 反洗钱可疑交易报告流程
2. **风控要求**：
   - 大额交易需增加审批层级
   - 高风险操作需双人复核
   - 关键节点需留存审计日志
3. **节点设计**：
   - 使用排他网关根据金额/风险等级分流
   - 并行网关用于同时进行的征信查询和资料审核
   - 定时器节点用于审批超时提醒`,
    thinkerPromptAddon: `当用户需求涉及金融场景时，优先识别以下关键词并路由到对应领域：
- 贷款、审批、开户、理财、基金、保险、信用卡、征信、风控、合规、转账、汇款
- 金融流程通常需要严格的审批链（chain 模式，先表单后流程）`,
    toolNames: ['search_finance_templates', 'validate_finance_form'],
    templates: [
      {
        id: 'finance-loan-application',
        name: '贷款申请表',
        description: '个人贷款申请表模板，包含基本信息、收入信息、贷款信息',
        type: 'form',
        schema: [
          {
            id: 'card-1',
            type: 'card',
            props: { title: '申请人基本信息', bordered: true },
            children: [
              { id: 'input-name', type: 'input', props: { label: '姓名', field: 'applicantName', required: true } },
              { id: 'select-gender', type: 'select', props: { label: '性别', field: 'gender', options: [{ label: '男', value: 'male' }, { label: '女', value: 'female' }] } },
              { id: 'input-idcard', type: 'input', props: { label: '身份证号', field: 'idCard', required: true, sensitive: true } },
              { id: 'input-phone', type: 'input', props: { label: '手机号', field: 'phone', required: true, sensitive: true } },
              { id: 'input-address', type: 'input', props: { label: '现居住地址', field: 'address', required: true } },
            ],
          },
          {
            id: 'card-2',
            type: 'card',
            props: { title: '收入与资产', bordered: true },
            children: [
              { id: 'select-employment', type: 'select', props: { label: '职业类型', field: 'employmentType', options: [{ label: '工薪族', value: 'salaried' }, { label: '企业主', value: 'business_owner' }, { label: '自由职业', value: 'freelance' }] } },
              { id: 'input-company', type: 'input', props: { label: '工作单位', field: 'company' } },
              { id: 'number-income', type: 'number', props: { label: '月收入(元)', field: 'monthlyIncome', required: true, min: 0 } },
              { id: 'select-income-range', type: 'select', props: { label: '年收入区间', field: 'annualIncomeRange', options: [{ label: '10万以下', value: 'under100k' }, { label: '10-30万', value: '100k-300k' }, { label: '30-50万', value: '300k-500k' }, { label: '50-100万', value: '500k-1m' }, { label: '100万以上', value: 'above1m' }] } },
            ],
          },
          {
            id: 'card-3',
            type: 'card',
            props: { title: '贷款信息', bordered: true },
            children: [
              { id: 'select-loan-type', type: 'select', props: { label: '贷款类型', field: 'loanType', required: true, options: [{ label: '住房贷款', value: 'mortgage' }, { label: '汽车贷款', value: 'auto' }, { label: '信用贷款', value: 'credit' }, { label: '经营贷款', value: 'business' }] } },
              { id: 'number-amount', type: 'number', props: { label: '申请金额(元)', field: 'loanAmount', required: true, min: 0 } },
              { id: 'select-term', type: 'select', props: { label: '贷款期限', field: 'loanTerm', required: true, options: [{ label: '12期', value: '12' }, { label: '24期', value: '24' }, { label: '36期', value: '36' }, { label: '60期', value: '60' }, { label: '120期', value: '120' }, { label: '240期', value: '240' }, { label: '360期', value: '360' }] } },
              { id: 'textarea-purpose', type: 'textarea', props: { label: '贷款用途', field: 'loanPurpose', required: true, rows: 3 } },
            ],
          },
        ],
      },
      {
        id: 'finance-risk-assessment',
        name: '风险评估问卷',
        description: '投资者风险承受能力评估问卷',
        type: 'form',
        schema: [
          {
            id: 'card-1',
            type: 'card',
            props: { title: '投资者风险评估', bordered: true },
            children: [
              { id: 'select-age', type: 'select', props: { label: '您的年龄', field: 'ageRange', required: true, options: [{ label: '18-30岁', value: '18-30' }, { label: '31-50岁', value: '31-50' }, { label: '51-65岁', value: '51-65' }, { label: '65岁以上', value: '65+' }] } },
              { id: 'select-experience', type: 'select', props: { label: '投资经验', field: 'investmentExperience', required: true, options: [{ label: '无经验', value: 'none' }, { label: '1-3年', value: '1-3y' }, { label: '3-5年', value: '3-5y' }, { label: '5年以上', value: '5y+' }] } },
              { id: 'select-tolerance', type: 'select', props: { label: '最大可承受亏损', field: 'lossTolerance', required: true, options: [{ label: '不能接受亏损', value: '0' }, { label: '10%以内', value: '10' }, { label: '30%以内', value: '30' }, { label: '50%以内', value: '50' }, { label: '50%以上', value: '50+' }] } },
              { id: 'select-horizon', type: 'select', props: { label: '投资期限', field: 'investmentHorizon', required: true, options: [{ label: '1年以内', value: 'under1y' }, { label: '1-3年', value: '1-3y' }, { label: '3-5年', value: '3-5y' }, { label: '5年以上', value: '5y+' }] } },
              { id: 'select-purpose', type: 'select', props: { label: '投资目的', field: 'investmentPurpose', required: true, options: [{ label: '保值', value: 'preserve' }, { label: '稳健增值', value: 'stable' }, { label: '积极增值', value: 'growth' }, { label: '高收益', value: 'aggressive' }] } },
            ],
          },
        ],
      },
      {
        id: 'finance-loan-approval',
        name: '贷款审批流程',
        description: '标准贷款审批流程，含初审、复审、终审、放款',
        type: 'flow',
        schema: [
          { id: 'start', type: 'startEvent', data: { bpmnType: 'startEvent', label: '提交贷款申请' } },
          { id: 'submit', type: 'userTask', data: { bpmnType: 'userTask', label: '填写贷款申请', assignee: 'applicant' } },
          { id: 'auto-check', type: 'serviceTask', data: { bpmnType: 'serviceTask', label: '系统自动征信查询' } },
          { id: 'preliminary', type: 'userTask', data: { bpmnType: 'userTask', label: '初审', assignee: 'loanOfficer' } },
          { id: 'gw-amount', type: 'exclusiveGateway', data: { bpmnType: 'exclusiveGateway', label: '金额判断' } },
          { id: 'review', type: 'userTask', data: { bpmnType: 'userTask', label: '复审', assignee: 'seniorReviewer' } },
          { id: 'final-approve', type: 'userTask', data: { bpmnType: 'userTask', label: '终审', assignee: 'deptDirector' } },
          { id: 'gw-result', type: 'exclusiveGateway', data: { bpmnType: 'exclusiveGateway', label: '审批结果' } },
          { id: 'notify-approved', type: 'serviceTask', data: { bpmnType: 'serviceTask', label: '通知放款' } },
          { id: 'notify-rejected', type: 'serviceTask', data: { bpmnType: 'serviceTask', label: '通知拒绝' } },
          { id: 'end', type: 'endEvent', data: { bpmnType: 'endEvent', label: '流程结束' } },
        ],
      },
    ],
  },

  education: {
    name: '教育行业',
    description: '专注于教育行业的表单和流程生成',
    editorPromptAddon: `## 教育行业特殊要求

你正在为教育行业生成表单/页面，请遵循以下规范：

1. **专业术语**：使用教育行业标准术语（如：学分、绩点、学籍、培养方案、毕业设计等）
2. **隐私保护**：学生信息需符合《未成年人保护法》和《个人信息保护法》
3. **常用表单场景**：
   - 学生入学登记表
   - 课程选课表
   - 成绩录入表
   - 学生请假申请
   - 教师评教表
   - 毕业设计开题/答辩申请
   - 奖助学金申请表
   - 转专业/休学/复学申请
   - 实习申请表
4. **字段设计**：
   - 学号使用固定格式校验
   - 成绩字段使用 0-100 或等级制
   - 学期字段使用"2024-2025-1"格式
   - 日期字段关联校历`,
    flowPromptAddon: `## 教育行业流程特殊要求

你正在为教育行业生成流程，请遵循以下规范：

1. **常见教育流程**：
   - 学生请假审批流程（学生申请 → 辅导员审批 → 销假）
   - 成绩申诉流程
   - 转专业申请流程
   - 毕业论文答辩流程（开题 → 中期检查 → 查重 → 评审 → 答辩）
   - 奖助学金评审流程
   - 教师职称评审流程
   - 课程建设审批流程
2. **节点设计**：
   - 多级审批通常：学生 → 辅导员 → 系主任 → 院长
   - 定时器节点用于截止日期提醒
   - 并行网关用于多位评审同时打分`,
    thinkerPromptAddon: `当用户需求涉及教育场景时，优先识别以下关键词并路由到对应领域：
- 学生、教师、课程、成绩、学分、请假、审批、入学、毕业、论文、答辩、评教、选课
- 教育流程通常需要多级审批链`,
    toolNames: ['search_education_templates', 'validate_education_form'],
    templates: [
      {
        id: 'education-student-enrollment',
        name: '学生入学登记表',
        description: '标准学生入学信息登记表',
        type: 'form',
        schema: [
          {
            id: 'card-1',
            type: 'card',
            props: { title: '基本信息', bordered: true },
            children: [
              { id: 'input-name', type: 'input', props: { label: '姓名', field: 'studentName', required: true } },
              { id: 'select-gender', type: 'select', props: { label: '性别', field: 'gender', options: [{ label: '男', value: 'male' }, { label: '女', value: 'female' }] } },
              { id: 'date-birthday', type: 'datePicker', props: { label: '出生日期', field: 'birthday', required: true } },
              { id: 'input-idcard', type: 'input', props: { label: '身份证号', field: 'idCard', required: true, sensitive: true } },
              { id: 'input-phone', type: 'input', props: { label: '联系电话', field: 'phone', sensitive: true } },
            ],
          },
          {
            id: 'card-2',
            type: 'card',
            props: { title: '学籍信息', bordered: true },
            children: [
              { id: 'input-studentno', type: 'input', props: { label: '学号', field: 'studentNo', required: true } },
              { id: 'select-college', type: 'select', props: { label: '学院', field: 'college', required: true, options: [{ label: '计算机学院', value: 'cs' }, { label: '商学院', value: 'business' }, { label: '文学院', value: 'arts' }, { label: '理学院', value: 'science' }] } },
              { id: 'input-major', type: 'input', props: { label: '专业', field: 'major', required: true } },
              { id: 'select-grade', type: 'select', props: { label: '年级', field: 'grade', options: [{ label: '大一', value: '1' }, { label: '大二', value: '2' }, { label: '大三', value: '3' }, { label: '大四', value: '4' }] } },
              { id: 'select-class', type: 'select', props: { label: '班级', field: 'className', options: [{ label: '1班', value: '1' }, { label: '2班', value: '2' }, { label: '3班', value: '3' }] } },
            ],
          },
        ],
      },
      {
        id: 'education-leave-request',
        name: '学生请假申请',
        description: '学生请假申请表单',
        type: 'form',
        schema: [
          {
            id: 'card-1',
            type: 'card',
            props: { title: '请假信息', bordered: true },
            children: [
              { id: 'input-name', type: 'input', props: { label: '姓名', field: 'studentName', required: true } },
              { id: 'input-studentno', type: 'input', props: { label: '学号', field: 'studentNo', required: true } },
              { id: 'select-type', type: 'select', props: { label: '请假类型', field: 'leaveType', required: true, options: [{ label: '事假', value: 'personal' }, { label: '病假', value: 'sick' }, { label: '公假', value: 'official' }] } },
              { id: 'date-start', type: 'datePicker', props: { label: '开始日期', field: 'startDate', required: true } },
              { id: 'date-end', type: 'datePicker', props: { label: '结束日期', field: 'endDate', required: true } },
              { id: 'textarea-reason', type: 'textarea', props: { label: '请假事由', field: 'reason', required: true, rows: 4 } },
            ],
          },
        ],
      },
      {
        id: 'education-leave-approval',
        name: '学生请假审批流程',
        description: '标准学生请假审批流程',
        type: 'flow',
        schema: [
          { id: 'start', type: 'startEvent', data: { bpmnType: 'startEvent', label: '提交请假申请' } },
          { id: 'apply', type: 'userTask', data: { bpmnType: 'userTask', label: '填写请假单', assignee: 'student' } },
          { id: 'instructor', type: 'userTask', data: { bpmnType: 'userTask', label: '辅导员审批', assignee: 'instructor' } },
          { id: 'gw-result', type: 'exclusiveGateway', data: { bpmnType: 'exclusiveGateway', label: '审批结果' } },
          { id: 'gw-duration', type: 'exclusiveGateway', data: { bpmnType: 'exclusiveGateway', label: '请假天数' } },
          { id: 'dean-approve', type: 'userTask', data: { bpmnType: 'userTask', label: '院系审批', assignee: 'dean' } },
          { id: 'notify-approved', type: 'serviceTask', data: { bpmnType: 'serviceTask', label: '通知批准' } },
          { id: 'notify-rejected', type: 'serviceTask', data: { bpmnType: 'serviceTask', label: '通知驳回' } },
          { id: 'end', type: 'endEvent', data: { bpmnType: 'endEvent', label: '流程结束' } },
        ],
      },
    ],
  },
}

// ────────────────────────────────────────────
// Helper functions
// ────────────────────────────────────────────

/**
 * Get all available industry types.
 */
export function getAvailableIndustries(): Array<{ value: IndustryType; label: string; description: string }> {
  return Object.entries(industryConfigs).map(([key, config]) => ({
    value: key as IndustryType,
    label: config.name,
    description: config.description,
  }))
}

/**
 * Get industry config by type. Returns undefined if not found.
 */
export function getIndustryConfig(industry: IndustryType): IndustryConfig | undefined {
  return industryConfigs[industry]
}

/**
 * Get templates for a specific industry, optionally filtered by type.
 */
export function getIndustryTemplates(
  industry: IndustryType,
  type?: 'form' | 'flow',
): IndustryTemplate[] {
  const config = industryConfigs[industry]
  if (!config) return []
  if (type) return config.templates.filter((t) => t.type === type)
  return config.templates
}

/**
 * Search industry templates by keyword.
 */
export function searchIndustryTemplates(
  keyword: string,
  industry?: IndustryType,
): Array<IndustryTemplate & { industry: IndustryType }> {
  const results: Array<IndustryTemplate & { industry: IndustryType }> = []
  const industries = industry ? [industry] : (Object.keys(industryConfigs) as IndustryType[])

  for (const ind of industries) {
    const config = industryConfigs[ind]
    for (const template of config.templates) {
      if (
        template.name.includes(keyword) ||
        template.description.includes(keyword)
      ) {
        results.push({ ...template, industry: ind })
      }
    }
  }

  return results
}
