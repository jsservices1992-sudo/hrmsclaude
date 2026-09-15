import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------
   Conventions
   - Money is stored in PAISE (integer). Never floats for currency.
   - Dates are ISO "YYYY-MM-DD" strings. Periods are (year, month).
   - Statutory config is EFFECTIVE-DATED: rows carry effectiveFrom /
     effectiveTo, and a payroll run records which versions it used.
     This is what makes historic runs reproducible (PRD FR-AUD-2).
   ------------------------------------------------------------------ */

export const companies = pgTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  legalName: text("legal_name").notNull(),
  cin: text("cin"),
  pan: text("pan"),
  tan: text("tan"),
  pfCode: text("pf_code"),
  esicCode: text("esic_code"),
  /* Printed on payslips and letters. A URL or a data: URI — the payslip
     falls back to a monogram of the company name when it is not set, so
     a slip never prints with a hole where a logo should be. */
  logoUrl: text("logo_url"),
  /* Registered office — the address that appears on statutory returns. */
  registeredAddress: text("registered_address"),
  registeredCity: text("registered_city"),
  registeredStateCode: text("registered_state_code"),
  registeredPincode: text("registered_pincode"),
  isDefault: boolean("is_default").notNull().default(false),
  active: boolean("active").notNull().default(true),
  /* Payroll conventions — PRD FR-SET-2/3/4 */
  prorationBasis: text("proration_basis", {
    enum: ["calendar_days", "fixed_30", "working_days", "standard_days"],
  })
    .notNull()
    .default("calendar_days"),
  standardDays: integer("standard_days").notNull().default(26),
  sandwichRule: boolean("sandwich_rule")
    .notNull()
    .default(false),
  roundingMode: text("rounding_mode", { enum: ["nearest", "up", "down"] })
    .notNull()
    .default("nearest"),
  /* Which levels rounding is applied at — FR-SET-4. Rounding every level
     makes components stop summing to gross, so this is deliberate. */
  roundComponents: boolean("round_components")
    .notNull()
    .default(false),
  roundGross: boolean("round_gross").notNull().default(false),
  roundNet: boolean("round_net").notNull().default(true),
  epfOnActualBasic: boolean("epf_on_actual_basic")
    .notNull()
    .default(false),
  /* What an overtime hour is worth, set by the administrator. Null means
     overtime has not been configured, and hours cannot be entered until
     it is — an OT amount with no agreed rate is not auditable. */
  otRatePaisePerHour: bigint("ot_rate_paise_per_hour", { mode: "number" }),
  /* Payroll calendar defaults — FR-SET-1. */
  payDayConvention: text("pay_day_convention", {
    enum: ["last_calendar_day", "last_working_day", "fixed_date"],
  })
    .notNull()
    .default("last_working_day"),
  payDayOfMonth: integer("pay_day_of_month").notNull().default(28),
  /** Day of month attendance closes. 0 means month end. */
  attendanceCutoffDay: integer("attendance_cutoff_day").notNull().default(0),
  /** Where the cut-off is not month end, how the tail is handled. */
  postCutoffTreatment: text("post_cutoff_treatment", {
    enum: ["lag_to_next", "estimate_and_true_up"],
  })
    .notNull()
    .default("lag_to_next"),
  /** Retrospective loss of pay after a period closes — FR-SET-3. */
  retroLopTreatment: text("retro_lop_treatment", {
    enum: ["adjust_next_period", "reopen_run"],
  })
    .notNull()
    .default("adjust_next_period"),
  financialYearStartMonth: integer("financial_year_start_month")
    .notNull()
    .default(4),
  createdAt: text("created_at").notNull(),
});

/** Disbursement and statutory remittance accounts — FR-PAY-1. */
export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    purpose: text("purpose", {
      enum: ["salary", "pf", "esic", "tds", "pt", "lwf", "reimbursement"],
    }).notNull(),
    bankName: text("bank_name").notNull(),
    accountNumber: text("account_number").notNull(),
    ifsc: text("ifsc").notNull(),
    /** Format the bank expects for the disbursement file. */
    fileFormat: text("file_format", {
      enum: ["hdfc", "icici", "axis", "sbi", "kotak", "neft_generic"],
    })
      .notNull()
      .default("neft_generic"),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
  },
  (t) => [index("bank_accounts_company_idx").on(t.companyId)],
);

/**
 * Per-period calendar — FR-SET-1. Rows exist only where a company has
 * overridden its defaults for that month.
 */
export const payrollCalendars = pgTable(
  "payroll_calendars",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    attendanceCutoff: text("attendance_cutoff").notNull(),
    inputFreeze: text("input_freeze").notNull(),
    approvalDeadline: text("approval_deadline").notNull(),
    payDate: text("pay_date").notNull(),
    locked: boolean("locked").notNull().default(false),
    note: text("note"),
  },
  (t) => [
    uniqueIndex("payroll_calendar_idx").on(t.companyId, t.periodYear, t.periodMonth),
  ],
);

/**
 * Payroll groups — FR-SET-6. Membership is derived by rule, never
 * maintained by hand, so a transfer moves someone automatically.
 */
export const payrollGroups = pgTable(
  "payroll_groups",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    ruleType: text("rule_type", {
      enum: ["all", "branch", "department", "grade", "employment_type"],
    }).notNull(),
    /** Comma-separated ids or codes matching ruleType. */
    ruleValue: text("rule_value"),
    sequence: integer("sequence").notNull().default(0),
  },
  (t) => [index("payroll_groups_company_idx").on(t.companyId)],
);

/**
 * A department's own payroll conventions — proration, rounding — where
 * they genuinely differ from the company default (a factory floor paid
 * on working days while HQ runs calendar days is the real case this
 * exists for). Every field is nullable: null means "inherit the company
 * setting", so a department can override just one convention without
 * having to restate all of them.
 */
export const departmentPayrollOverrides = pgTable(
  "department_payroll_overrides",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id),
    prorationBasis: text("proration_basis", {
      enum: ["calendar_days", "fixed_30", "working_days", "standard_days"],
    }),
    standardDays: integer("standard_days"),
    roundingMode: text("rounding_mode", { enum: ["nearest", "up", "down"] }),
    roundComponents: boolean("round_components"),
    roundGross: boolean("round_gross"),
    roundNet: boolean("round_net"),
    updatedBy: text("updated_by"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("dept_payroll_override_idx").on(t.companyId, t.departmentId)],
);

/**
 * A company registers separately in each state it employs people in.
 * FR-MC-1 — PT and LWF registration numbers are held per state, not once
 * per company, because that is how the registrations actually work.
 */
export const companyRegistrations = pgTable(
  "company_registrations",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    stateCode: text("state_code").notNull(),
    kind: text("kind", { enum: ["pt", "lwf", "shops_est"] }).notNull(),
    registrationNumber: text("registration_number").notNull(),
    /** PTRC and PTEC are separate numbers in several states. */
    secondaryNumber: text("secondary_number"),
    effectiveFrom: text("effective_from"),
    note: text("note"),
  },
  (t) => [
    uniqueIndex("company_reg_idx").on(t.companyId, t.stateCode, t.kind),
    index("company_reg_company_idx").on(t.companyId),
  ],
);

export const branches = pgTable(
  "branches",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    code: text("code"),
    addressLine: text("address_line"),
    stateCode: text("state_code").notNull(),
    city: text("city"),
    pincode: text("pincode"),
    costCentre: text("cost_centre"),
    /* Branch-level overrides. Null means inherit from the company —
       FR-MC-2. Only set these for the genuine edge cases. */
    ptRegNo: text("pt_reg_no"),
    lwfRegNo: text("lwf_reg_no"),
    pfCodeOverride: text("pf_code_override"),
    esicCodeOverride: text("esic_code_override"),
    /* Derived from the state table, but overridable when the law changes
       before we ship a config update. Null means follow the state table. */
    lwfApplicableOverride: boolean("lwf_applicable_override"),
    /* ESIC applies only in implemented areas — PRD FR-STAT-3 */
    esicImplementedArea: boolean("esic_implemented_area")
      .notNull()
      .default(true),
    active: boolean("active").notNull().default(true),
  },
  (t) => [index("branches_company_idx").on(t.companyId)],
);

/** Department hierarchy — parentId gives the tree. FR-HRIS-3. */
export const departments = pgTable(
  "departments",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    parentId: text("parent_id"),
    costCentre: text("cost_centre"),
    /* Budgeted headcount for this department — the number the business
       has approved, against which open positions are counted. Null means
       no plan has been set, which reads differently from a plan of zero:
       one is undecided, the other is "no more hiring here". */
    approvedHeadcount: integer("approved_headcount"),
  },
  (t) => [index("departments_company_idx").on(t.companyId)],
);

/** Grades drive notice period, leave eligibility and structure defaults. */
export const grades = pgTable(
  "grades",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    /** Ascending seniority, used for ordering and skip-level routing. */
    level: integer("level").notNull(),
    noticeDays: integer("notice_days"),
    probationMonths: integer("probation_months"),
  },
  (t) => [uniqueIndex("grades_company_name_idx").on(t.companyId, t.name)],
);

export const employees = pgTable(
  "employees",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    empCode: text("emp_code").notNull(),
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    lastName: text("last_name").notNull(),
    email: text("email"),
    personalEmail: text("personal_email"),
    mobile: text("mobile"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    dateOfBirth: text("date_of_birth"),
    bloodGroup: text("blood_group"),
    maritalStatus: text("marital_status", {
      enum: ["single", "married", "other"],
    }),
    addressLine: text("address_line"),
    city: text("city"),
    stateCode: text("state_code"),
    pincode: text("pincode"),
    designation: text("designation"),
    /** Legacy free-text; departmentId is authoritative once set. */
    department: text("department"),
    departmentId: text("department_id").references(() => departments.id),
    gradeId: text("grade_id").references(() => grades.id),
    /** Self-reference: the reporting line that generates the org chart. */
    managerId: text("manager_id"),
    probationEndDate: text("probation_end_date"),
    confirmationDate: text("confirmation_date"),
    gender: text("gender", { enum: ["female", "male", "other"] })
      .notNull()
      .default("other"),
    dateOfJoining: text("date_of_joining").notNull(),
    dateOfExit: text("date_of_exit"),
    employmentType: text("employment_type", {
      enum: ["permanent", "probation", "contract", "intern", "consultant"],
    })
      .notNull()
      .default("permanent"),
    status: text("status", { enum: ["active", "resigned", "exited"] })
      .notNull()
      .default("active"),
    pan: text("pan"),
    uan: text("uan"),
    esicIp: text("esic_ip"),
    /* No prior PF membership + basic above ceiling at joining = excluded
       employee, PF optional. PRD FR-STAT-1 */
    hadPriorPfMembership: boolean("had_prior_pf_membership")
      .notNull()
      .default(false),
    pfOptedIn: boolean("pf_opted_in")
      .notNull()
      .default(true),
    vpfPercent: real("vpf_percent").notNull().default(0),
    taxRegime: text("tax_regime", { enum: ["old", "new"] })
      .notNull()
      .default("new"),
    bankAccount: text("bank_account"),
    ifsc: text("ifsc"),
    /** Who created the record — FR-AUD-4 separates this from approval. */
    createdBy: text("created_by"),
  },
  (t) => [
    uniqueIndex("employees_company_code_idx").on(t.companyId, t.empCode),
    index("employees_branch_idx").on(t.branchId),
  ],
);

/**
 * An employee asking for their own record to be corrected.
 *
 * The portal used to say "contact HR" and stop there, which meant a
 * changed phone number lived in somebody's inbox and a changed bank
 * account had no trail at all. A request is a row: what it says now,
 * what it should say, who asked, who decided. Nothing is written onto
 * the employee record until somebody approves it — FR-HRIS-3.
 */
export const profileChangeRequests = pgTable(
  "profile_change_requests",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    /** The employee column being changed; see lib/ess/profile.ts. */
    field: text("field").notNull(),
    /** What the record said when the request was raised. */
    currentValue: text("current_value"),
    requestedValue: text("requested_value").notNull(),
    reason: text("reason"),
    /** Supporting evidence, where the field demands it (bank, PAN). */
    documentId: text("document_id").references(() => employeeDocuments.id),
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    decidedBy: text("decided_by"),
    decidedAt: text("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("profile_change_emp_idx").on(t.employeeId, t.status),
    index("profile_change_status_idx").on(t.status),
  ],
);

/**
 * Custom fields — FR-HRIS-2. HR defines these without an engineering
 * change; values live in a separate table keyed by definition.
 */
export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    code: text("code").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type", {
      enum: ["text", "number", "date", "select", "boolean"],
    }).notNull(),
    /** Comma-separated options for a select. */
    options: text("options"),
    required: boolean("required").notNull().default(false),
    /** Groups the field under a section on the profile. */
    section: text("section").notNull().default("Additional"),
    /** Sensitive fields follow compensation visibility rules. */
    sensitive: boolean("sensitive")
      .notNull()
      .default(false),
    sequence: integer("sequence").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("cfd_company_code_idx").on(t.companyId, t.code)],
);

export const customFieldValues = pgTable(
  "custom_field_values",
  {
    id: text("id").primaryKey(),
    definitionId: text("definition_id")
      .notNull()
      .references(() => customFieldDefinitions.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    value: text("value"),
  },
  (t) => [uniqueIndex("cfv_def_emp_idx").on(t.definitionId, t.employeeId)],
);

/** Employee documents with expiry tracking — FR-HRIS-4. */
export const employeeDocuments = pgTable(
  "employee_documents",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    docType: text("doc_type").notNull(),
    label: text("label").notNull(),
    /** Path or object key. No file bytes in the database. */
    storageRef: text("storage_ref"),
    issuedOn: text("issued_on"),
    /** Expiry drives the renewal task rather than sitting silently. */
    expiresOn: text("expires_on"),
    verified: boolean("verified").notNull().default(false),
    verifiedBy: text("verified_by"),
    /** Restricted documents are visible only to HR and admin. */
    restricted: boolean("restricted")
      .notNull()
      .default(false),
    uploadedAt: text("uploaded_at").notNull(),
  },
  (t) => [index("emp_docs_employee_idx").on(t.employeeId)],
);

/* ---------------- compensation ---------------- */

export const payComponents = pgTable(
  "pay_components",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind", {
      enum: ["earning", "deduction", "employer_contribution"],
    }).notNull(),
    calcMethod: text("calc_method", {
      enum: ["fixed", "percent_of_basic", "percent_of_gross", "percent_of", "balance"],
    })
      .notNull()
      .default("fixed"),
    percentValue: real("percent_value").notNull().default(0),
    /** Component code referenced by the percent_of method. */
    percentOfCode: text("percent_of_code"),
    fixedPaise: bigint("fixed_paise", { mode: "number" }).notNull().default(0),
    taxable: boolean("taxable").notNull().default(true),
    epfBase: boolean("epf_base").notNull().default(false),
    esicBase: boolean("esic_base").notNull().default(true),
    ptBase: boolean("pt_base").notNull().default(true),
    /** Counts toward the Payment of Bonus Act wage. */
    bonusBase: boolean("bonus_base").notNull().default(false),
    /** Counts toward gratuity's "last drawn wages". */
    gratuityBase: boolean("gratuity_base")
      .notNull()
      .default(false),
    prorates: boolean("prorates").notNull().default(true),
    active: boolean("active").notNull().default(true),
    sequence: integer("sequence").notNull().default(0),
  },
  (t) => [uniqueIndex("pay_components_company_code_idx").on(t.companyId, t.code)],
);

/** Named structures assignable by grade, department or individually. */
export const salaryStructures = pgTable(
  "salary_structures",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    description: text("description"),
    /** Guardrail: basic must be at least this percentage of gross. */
    minBasicPercentOfGross: real("min_basic_percent_of_gross")
      .notNull()
      .default(40),
    /** Default for a grade, applied to new joiners at that grade. */
    gradeId: text("grade_id").references(() => grades.id),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    effectiveFrom: text("effective_from").notNull(),
  },
  (t) => [index("salary_structures_company_idx").on(t.companyId)],
);

/** Which components a structure contains, and with what settings. */
export const salaryStructureLines = pgTable(
  "salary_structure_lines",
  {
    id: text("id").primaryKey(),
    structureId: text("structure_id")
      .notNull()
      .references(() => salaryStructures.id),
    componentId: text("component_id")
      .notNull()
      .references(() => payComponents.id),
    /** Null means inherit the component's own definition. */
    calcMethodOverride: text("calc_method_override"),
    percentValueOverride: real("percent_value_override"),
    fixedPaiseOverride: bigint("fixed_paise_override", { mode: "number" }),
    sequence: integer("sequence").notNull().default(0),
  },
  (t) => [
    uniqueIndex("structure_line_idx").on(t.structureId, t.componentId),
  ],
);

/**
 * A department's assigned structure, absent a per-employee pin. Row
 * presence means "this department overrides the company default" — there
 * is no null-means-inherit column here, since the whole row is the
 * override (mirrors departmentPayrollOverrides' one-row-per-department
 * shape, but this table only ever has one field to set).
 */
export const departmentSalaryStructureOverrides = pgTable(
  "department_salary_structure_overrides",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id),
    structureId: text("structure_id")
      .notNull()
      .references(() => salaryStructures.id),
    updatedBy: text("updated_by"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("dept_salary_structure_override_idx").on(t.companyId, t.departmentId),
  ],
);

/* ---------------- flexible benefits (§3.8) ---------------- */

export const flexiPlans = pgTable(
  "flexi_plans",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Total allocable across all heads, per year. */
    totalAllocablePaise: bigint("total_allocable_paise", { mode: "number" }).notNull(),
    /** Null applies to every grade. */
    gradeId: text("grade_id").references(() => grades.id),
    financialYear: integer("financial_year").notNull(),
    /** Declaration window. Outside it, allocations are locked. */
    declarationOpensOn: text("declaration_opens_on").notNull(),
    declarationClosesOn: text("declaration_closes_on").notNull(),
    /** Claim submission window for the year. */
    claimClosesOn: text("claim_closes_on").notNull(),
    /** Month unclaimed balances are paid out as taxable. */
    residualPayoutMonth: integer("residual_payout_month").notNull().default(2),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("flexi_plan_idx").on(t.companyId, t.code, t.financialYear)],
);

export const flexiHeads = pgTable(
  "flexi_heads",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => flexiPlans.id),
    code: text("code").notNull(),
    label: text("label").notNull(),
    exemptionBasis: text("exemption_basis", {
      enum: ["actual_bills", "statutory_cap", "journey_based", "none"],
    }).notNull(),
    annualCapPaise: bigint("annual_cap_paise", { mode: "number" }),
    /** Statutory ceiling, independent of what the plan allows. */
    statutoryAnnualCapPaise: bigint("statutory_annual_cap_paise", { mode: "number" }),
    minAnnualPaise: bigint("min_annual_paise", { mode: "number" }).notNull().default(0),
    /** Most flexi exemptions do not survive the new regime. */
    availableInNewRegime: boolean("available_in_new_regime")
      .notNull()
      .default(false),
    requiresProof: boolean("requires_proof")
      .notNull()
      .default(true),
    sequence: integer("sequence").notNull().default(0),
  },
  (t) => [uniqueIndex("flexi_head_idx").on(t.planId, t.code)],
);

export const flexiDeclarations = pgTable(
  "flexi_declarations",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => flexiPlans.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    headId: text("head_id")
      .notNull()
      .references(() => flexiHeads.id),
    annualPaise: bigint("annual_paise", { mode: "number" }).notNull(),
    /** Regime in force when declared, so the advice can be reproduced. */
    declaredUnderRegime: text("declared_under_regime", { enum: ["old", "new"] })
      .notNull()
      .default("new"),
    submittedAt: text("submitted_at").notNull(),
  },
  (t) => [uniqueIndex("flexi_decl_idx").on(t.employeeId, t.headId, t.planId)],
);

export const flexiClaims = pgTable(
  "flexi_claims",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => flexiPlans.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    headId: text("head_id")
      .notNull()
      .references(() => flexiHeads.id),
    claimPaise: bigint("claim_paise", { mode: "number" }).notNull(),
    /** Fare portion, for journey-based heads such as LTA. */
    farePaise: bigint("fare_paise", { mode: "number" }),
    billRef: text("bill_ref"),
    billDate: text("bill_date"),
    status: text("status", {
      enum: ["pending", "approved", "partial", "rejected"],
    })
      .notNull()
      .default("pending"),
    /** What was actually admitted, which may be less than claimed. */
    approvedPaise: bigint("approved_paise", { mode: "number" }).notNull().default(0),
    decisionNote: text("decision_note"),
    decidedBy: text("decided_by"),
    decidedAt: text("decided_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("flexi_claims_emp_idx").on(t.employeeId, t.planId)],
);

/** Effective-dated minimum wages by state and skill category — FR-CMP-3. */
export const minimumWages = pgTable(
  "minimum_wages",
  {
    id: text("id").primaryKey(),
    stateCode: text("state_code").notNull(),
    skillCategory: text("skill_category", {
      enum: ["unskilled", "semi_skilled", "skilled", "highly_skilled"],
    }).notNull(),
    monthlyPaise: bigint("monthly_paise", { mode: "number" }).notNull(),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    verified: boolean("verified").notNull().default(false),
    source: text("source"),
  },
  (t) => [index("minimum_wages_state_idx").on(t.stateCode, t.effectiveFrom)],
);

/* Effective-dated salary assignment — a revision is a new row, never an edit */
export const employeeSalaries = pgTable(
  "employee_salaries",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    monthlyGrossPaise: bigint("monthly_gross_paise", { mode: "number" }).notNull(),
    /** Structure in force for this assignment. Null falls back to default. */
    structureId: text("structure_id").references(() => salaryStructures.id),
    /** Annual CTC this gross was derived from, kept for the offer letter. */
    annualCtcPaise: bigint("annual_ctc_paise", { mode: "number" }),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    reason: text("reason"),
    revisionType: text("revision_type", {
      enum: ["initial", "annual", "promotion", "confirmation", "correction", "market"],
    })
      .notNull()
      .default("initial"),
    /** Arrears already booked for this revision, so it is not paid twice. */
    arrearsPaise: bigint("arrears_paise", { mode: "number" }).notNull().default(0),
    approvedBy: text("approved_by"),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("employee_salaries_emp_idx").on(t.employeeId, t.effectiveFrom)],
);

/* ---------------- statutory configuration (effective-dated) ---------------- */

/** Applicability map for all 28 states + 8 UTs. */
export const jurisdictions = pgTable("jurisdictions", {
  stateCode: text("state_code").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["state", "ut"] }).notNull(),
  ptApplicable: boolean("pt_applicable").notNull(),
  lwfApplicable: boolean("lwf_applicable").notNull(),
  /** Set where the applicability itself is contested and needs legal review. */
  verificationNote: text("verification_note"),
});

export const ptSlabs = pgTable(
  "pt_slabs",
  {
    id: text("id").primaryKey(),
    stateCode: text("state_code").notNull(),
    /** Inclusive lower bound of monthly PT base, in paise. */
    minPaise: bigint("min_paise", { mode: "number" }).notNull(),
    /** Inclusive upper bound; null means unbounded. */
    maxPaise: bigint("max_paise", { mode: "number" }),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    /** Some states (e.g. Maharashtra) deduct a different amount in one month. */
    overrideMonth: integer("override_month"),
    overrideAmountPaise: bigint("override_amount_paise", { mode: "number" }),
    /** Some states levy on gender-differentiated thresholds. */
    gender: text("gender", { enum: ["all", "female", "male"] })
      .notNull()
      .default("all"),
    annualCapPaise: bigint("annual_cap_paise", { mode: "number" }).notNull().default(250000),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    verified: boolean("verified").notNull().default(false),
    source: text("source"),
  },
  (t) => [index("pt_slabs_state_idx").on(t.stateCode, t.effectiveFrom)],
);

export const lwfRates = pgTable(
  "lwf_rates",
  {
    id: text("id").primaryKey(),
    stateCode: text("state_code").notNull(),
    employeePaise: bigint("employee_paise", { mode: "number" }).notNull(),
    employerPaise: bigint("employer_paise", { mode: "number" }).notNull(),
    frequency: text("frequency", {
      enum: ["monthly", "half_yearly", "annual"],
    }).notNull(),
    /** Comma-separated months (1-12) in which the deduction is taken. */
    deductionMonths: text("deduction_months").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    verified: boolean("verified").notNull().default(false),
    source: text("source"),
  },
  (t) => [index("lwf_rates_state_idx").on(t.stateCode, t.effectiveFrom)],
);

/** Scalar statutory parameters (EPF ceiling, ESIC threshold, rates…). */
export const statutoryParams = pgTable(
  "statutory_params",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    /** Paise for money, basis points for rates — `unit` disambiguates. */
    value: integer("value").notNull(),
    unit: text("unit", { enum: ["paise", "bps", "count"] }).notNull(),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    note: text("note"),
  },
  (t) => [index("statutory_params_key_idx").on(t.key, t.effectiveFrom)],
);

/* ---------------- payroll ---------------- */

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    version: integer("version").notNull().default(1),
    status: text("status", {
      enum: [
        "draft",
        "inputs_locked",
        "calculated",
        "in_review",
        "approved",
        "finalised",
        "disbursed",
        "closed",
      ],
    })
      .notNull()
      .default("draft"),
    /** Conventions frozen at calculation time, so a re-run reproduces. */
    prorationBasis: text("proration_basis").notNull(),
    /**
     * The exact statutory configuration used, serialised. A re-run of a
     * historic period replays this rather than today's rules — FR-AUD-2.
     */
    configSnapshot: text("config_snapshot"),
    preparedBy: text("prepared_by"),
    approvedBy: text("approved_by"),
    calculatedAt: text("calculated_at"),
    approvedAt: text("approved_at"),
    reopenReason: text("reopen_reason"),
    supersedesVersion: integer("supersedes_version"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("payroll_runs_period_idx").on(
      t.companyId,
      t.periodYear,
      t.periodMonth,
      t.version,
    ),
  ],
);

export const payrollLines = pgTable(
  "payroll_lines",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => payrollRuns.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    code: text("code").notNull(),
    label: text("label").notNull(),
    kind: text("kind", {
      enum: ["earning", "deduction", "employer_contribution", "info"],
    }).notNull(),
    /* What sort of pay this line is, where it is variable pay. The
       register breaks overtime and bonus into their own columns, and
       doing that by line code only worked while the codes were hardcoded
       — a configured pay type brings its own code, and the money landed
       in the wrong column. Null for ordinary structure and statutory
       lines, which the register totals as gross. */
    category: text("category", {
      enum: ["ot", "bonus", "incentive", "arrear", "deduction", "other"],
    }),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    /** How this figure was derived — powers the explainability requirement. */
    basis: text("basis"),
    sequence: integer("sequence").notNull().default(0),
  },
  (t) => [index("payroll_lines_run_emp_idx").on(t.runId, t.employeeId)],
);

export const payrollEmployeeSummaries = pgTable(
  "payroll_employee_summaries",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => payrollRuns.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    paidDays: real("paid_days").notNull(),
    totalDays: real("total_days").notNull(),
    lopDays: real("lop_days").notNull().default(0),
    grossPaise: bigint("gross_paise", { mode: "number" }).notNull(),
    deductionsPaise: bigint("deductions_paise", { mode: "number" }).notNull(),
    employerCostPaise: bigint("employer_cost_paise", { mode: "number" }).notNull(),
    netPaise: bigint("net_paise", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("payroll_summaries_run_emp_idx").on(t.runId, t.employeeId),
  ],
);

/**
 * A one-off earning (incentive) or deduction for one employee in one
 * period — not a recurring pay component, not a recoverable loan. Read at
 * calculation time and folded into that run's lines; the row itself is
 * never edited after a run has used it, only added or removed before the
 * next calculation.
 */
/**
 * The kinds of variable pay this company actually gives.
 *
 * Without a master list the payslip label was free text, so the same
 * thing was typed three different ways across a month and nothing could
 * be reported by type. Same shape as the loan-scheme master next door.
 */
export const variablePayTypes = pgTable(
  "variable_pay_types",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    /** Becomes the payslip line code, so it is stable and reportable. */
    code: text("code").notNull(),
    label: text("label").notNull(),
    category: text("category", {
      enum: ["ot", "bonus", "incentive", "arrear", "deduction", "other"],
    }).notNull(),
    /** Offered as the starting amount where one is usual. */
    defaultAmountPaise: bigint("default_amount_paise", { mode: "number" }),
    /* Raised by the system rather than chosen by a person — arrears come
       from a backdated revision. Hidden from the entry forms, shown in
       master data so the label on the payslip can still be changed. */
    systemManaged: boolean("system_managed")
      .notNull()
      .default(false),
    active: boolean("active").notNull().default(true),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("variable_pay_type_idx").on(t.companyId, t.code)],
);

export const payrollAdjustments = pgTable(
  "payroll_adjustments",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    kind: text("kind", { enum: ["earning", "deduction"] }).notNull(),
    /* What sort of variable pay this is. `kind` says which side of the
       payslip it lands on; this says what it is, so the register can show
       overtime and bonus in their own columns without guessing from the
       label. */
    category: text("category", {
      enum: ["ot", "bonus", "incentive", "arrear", "deduction", "other"],
    })
      .notNull()
      .default("other"),
    /* Which configured type this came from. Null for arrears, which the
       system raises itself rather than anyone picking. */
    typeId: text("type_id").references(() => variablePayTypes.id),
    code: text("code").notNull(),
    label: text("label").notNull(),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    /* Overtime is entered as hours against a rate; the rate is copied in
       so a historical line still explains itself after the company rate
       changes. Null for everything that is entered as a plain amount. */
    hours: real("hours"),
    ratePaisePerHour: bigint("rate_paise_per_hour", { mode: "number" }),
    reason: text("reason"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("payroll_adjustments_period_idx").on(t.employeeId, t.periodYear, t.periodMonth),
  ],
);

/* ---------------- attendance & leave (§3.4) ---------------- */

export const shifts = pgTable(
  "shifts",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Minutes from midnight. */
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    graceMinutes: integer("grace_minutes").notNull().default(15),
    fullDayMinutes: integer("full_day_minutes").notNull().default(480),
    halfDayMinutes: integer("half_day_minutes").notNull().default(240),
    /** Comma-separated 0-6, Sunday = 0. */
    weeklyOffDays: text("weekly_off_days").notNull().default("0"),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [uniqueIndex("shifts_company_code_idx").on(t.companyId, t.code)],
);

/** Per company, and optionally narrowed to one branch — FR-ATT-5. */
export const holidays = pgTable(
  "holidays",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    /** Null means it applies to every branch in the company. */
    branchId: text("branch_id").references(() => branches.id),
    date: text("date").notNull(),
    name: text("name").notNull(),
    /** Restricted holidays are opted into by the employee, not automatic. */
    restricted: boolean("restricted").notNull().default(false),
  },
  (t) => [index("holidays_company_date_idx").on(t.companyId, t.date)],
);

/**
 * One row per employee per date. Holds both the raw punches and the derived
 * status, so a disputed day can be reconstructed rather than re-derived.
 */
export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    date: text("date").notNull(),
    /** JSON array of { inMinute, outMinute }. */
    punchesJson: text("punches_json").notNull().default("[]"),
    dayType: text("day_type", { enum: ["working", "weekly_off", "holiday"] })
      .notNull()
      .default("working"),
    status: text("status", {
      enum: ["present", "half_day", "absent", "weekly_off", "holiday", "on_leave", "on_duty"],
    }).notNull(),
    workedMinutes: integer("worked_minutes").notNull().default(0),
    lateMinutes: integer("late_minutes").notNull().default(0),
    lopUnits: real("lop_units").notNull().default(0),
    basis: text("basis"),
    /** Set when a regularisation replaced the original punches. */
    regularised: boolean("regularised").notNull().default(false),
    source: text("source", { enum: ["device", "web", "mobile", "manual", "derived"] })
      .notNull()
      .default("derived"),
  },
  (t) => [uniqueIndex("attendance_emp_date_idx").on(t.employeeId, t.date)],
);

/** The original is never overwritten — FR-ATT-4. */
export const regularisationRequests = pgTable(
  "regularisation_requests",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    date: text("date").notNull(),
    /** What the record said before the correction. */
    originalStatus: text("original_status").notNull(),
    originalPunchesJson: text("original_punches_json").notNull().default("[]"),
    requestedPunchesJson: text("requested_punches_json").notNull().default("[]"),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    decidedBy: text("decided_by"),
    decidedAt: text("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("regularisation_emp_idx").on(t.employeeId, t.date)],
);

export const leaveTypes = pgTable(
  "leave_types",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    annualDays: real("annual_days").notNull().default(0),
    frequency: text("frequency", { enum: ["monthly", "quarterly", "annually"] })
      .notNull()
      .default("monthly"),
    paid: boolean("paid").notNull().default(true),
    accruesDuringProbation: boolean("accrues_during_probation")
      .notNull()
      .default(true),
    carryForwardCap: real("carry_forward_cap").notNull().default(0),
    encashable: boolean("encashable").notNull().default(false),
    allowNegative: boolean("allow_negative").notNull().default(false),
    rounding: text("rounding", { enum: ["none", "half_up", "down"] })
      .notNull()
      .default("none"),
    /**
     * The optional-holiday allowance. A company publishes a list of
     * restricted holidays and each employee picks a couple; marking one
     * leave type as the vehicle means the whole balance, approval and
     * payroll path is reused rather than rebuilt, and `annualDays` is
     * how many may be taken.
     */
    restrictedHoliday: boolean("restricted_holiday")
      .notNull()
      .default(false),
  },
  (t) => [uniqueIndex("leave_types_company_code_idx").on(t.companyId, t.code)],
);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    leaveTypeId: text("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    fromDate: text("from_date").notNull(),
    toDate: text("to_date").notNull(),
    days: real("days").notNull(),
    halfDay: boolean("half_day").notNull().default(false),
    reason: text("reason"),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "cancelled"],
    })
      .notNull()
      .default("pending"),
    /** Days that exceeded the balance and fell to loss of pay. */
    lopDays: real("lop_days").notNull().default(0),
    approverId: text("approver_id").references(() => employees.id),
    decidedBy: text("decided_by"),
    decidedAt: text("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("leave_requests_emp_idx").on(t.employeeId, t.fromDate)],
);

/** Attendance input per employee per period — drives loss of pay. */
export const attendanceInputs = pgTable(
  "attendance_inputs",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    lopDays: real("lop_days").notNull().default(0),
    /**
     * A hand override survives the next "Recompute" click — otherwise a
     * manual correction made right before running payroll is silently
     * lost the moment anyone recomputes from punches again.
     */
    overridden: boolean("overridden").notNull().default(false),
    overriddenBy: text("overridden_by"),
    overriddenAt: text("overridden_at"),
    overrideReason: text("override_reason"),
  },
  (t) => [
    uniqueIndex("attendance_period_idx").on(
      t.employeeId,
      t.periodYear,
      t.periodMonth,
    ),
  ],
);

/* ---------------- onboarding (§3.3) ---------------- */

/**
 * A joiner exists before the employee record does — FR-ONB-1. It holds
 * everything the candidate submits, and converts in one transaction on the
 * date of joining. It consumes no licence and appears in no payroll.
 */
export const joiners = pgTable(
  "joiners",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    branchId: text("branch_id").references(() => branches.id),
    departmentId: text("department_id").references(() => departments.id),
    gradeId: text("grade_id").references(() => grades.id),
    managerId: text("manager_id").references(() => employees.id),

    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    personalEmail: text("personal_email").notNull(),
    mobile: text("mobile"),
    designation: text("designation"),
    employmentType: text("employment_type", {
      enum: ["permanent", "probation", "contract", "intern", "consultant"],
    })
      .notNull()
      .default("permanent"),
    offeredCtcPaise: bigint("offered_ctc_paise", { mode: "number" }),
    /* The gross the offer actually resolves to — CTC carries employer PF,
       ESIC and gratuity on top, so it is never simply CTC ÷ 12. Solved
       when the offer is set, so conversion writes the agreed figure
       rather than re-deriving it against rates that may since have moved.
       Null on joiners offered before this was captured; conversion falls
       back to solving from the CTC. */
    offeredMonthlyGrossPaise: bigint("offered_monthly_gross_paise", { mode: "number" }),
    /* An explicit salary-structure pin for this joiner, carried onto the
       employee at conversion. Null means resolve from the department. */
    structureId: text("structure_id").references(() => salaryStructures.id),
    proposedDoj: text("proposed_doj").notNull(),

    /* Self-submitted profile — mirrors the employee master fields. */
    dateOfBirth: text("date_of_birth"),
    gender: text("gender", { enum: ["female", "male", "other"] }),
    addressLine: text("address_line"),
    city: text("city"),
    pincode: text("pincode"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    pan: text("pan"),
    uan: text("uan"),
    bankAccount: text("bank_account"),
    ifsc: text("ifsc"),
    hadPriorPfMembership: boolean("had_prior_pf_membership")
      .notNull()
      .default(false),

    /* Tokenised portal access — no account, no password. FR-ONB-3. */
    portalToken: text("portal_token").notNull(),
    portalTokenExpiresAt: text("portal_token_expires_at"),
    profileSubmittedAt: text("profile_submitted_at"),

    offerStatus: text("offer_status", {
      enum: ["draft", "sent", "accepted", "declined", "lapsed"],
    })
      .notNull()
      .default("draft"),
    offerSentAt: text("offer_sent_at"),
    offerRespondedAt: text("offer_responded_at"),
    /* Click-accept audit stamp where no e-sign provider is configured. */
    acceptanceIp: text("acceptance_ip"),
    acceptanceUserAgent: text("acceptance_user_agent"),

    bgvStatus: text("bgv_status", {
      enum: ["not_started", "initiated", "in_progress", "clear", "discrepancy", "failed"],
    })
      .notNull()
      .default("not_started"),
    bgvRef: text("bgv_ref"),

    status: text("status", {
      enum: ["draft", "offer_sent", "accepted", "onboarding", "joined", "dropped"],
    })
      .notNull()
      .default("draft"),
    /* Set once converted, so the link back to the employee is explicit. */
    convertedEmployeeId: text("converted_employee_id").references(() => employees.id),
    convertedAt: text("converted_at"),
    dropReason: text("drop_reason"),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("joiners_company_idx").on(t.companyId),
    uniqueIndex("joiners_token_idx").on(t.portalToken),
  ],
);

/** Checklist items — FR-ONB-4. Typed so format and expiry can be validated. */
export const joinerDocuments = pgTable(
  "joiner_documents",
  {
    id: text("id").primaryKey(),
    joinerId: text("joiner_id")
      .notNull()
      .references(() => joiners.id),
    docType: text("doc_type").notNull(),
    label: text("label").notNull(),
    category: text("category", {
      enum: ["identity", "banking", "employment", "education", "personal"],
    }).notNull(),
    mandatory: boolean("mandatory").notNull().default(true),
    status: text("status", {
      enum: ["pending", "uploaded", "verified", "rejected"],
    })
      .notNull()
      .default("pending"),
    storageRef: text("storage_ref"),
    /** A rejection reopens this item alone, not the whole checklist. */
    rejectionReason: text("rejection_reason"),
    uploadedAt: text("uploaded_at"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: text("reviewed_at"),
    sequence: integer("sequence").notNull().default(0),
  },
  (t) => [index("joiner_docs_idx").on(t.joinerId)],
);

/** Statutory declarations collected before day one — FR-ONB-5. */
export const joinerDeclarations = pgTable(
  "joiner_declarations",
  {
    id: text("id").primaryKey(),
    joinerId: text("joiner_id")
      .notNull()
      .references(() => joiners.id),
    form: text("form", {
      enum: ["epf_form_11", "epf_form_2", "gratuity_form_f", "esic_form_1", "form_12bb"],
    }).notNull(),
    status: text("status", { enum: ["pending", "submitted", "not_applicable"] })
      .notNull()
      .default("pending"),
    /** Nominee / declaration payload, serialised. */
    payload: text("payload"),
    submittedAt: text("submitted_at"),
  },
  (t) => [uniqueIndex("joiner_decl_idx").on(t.joinerId, t.form)],
);

/** Day-one provisioning fan-out — FR-ONB-10. */
export const joinerTasks = pgTable(
  "joiner_tasks",
  {
    id: text("id").primaryKey(),
    joinerId: text("joiner_id")
      .notNull()
      .references(() => joiners.id),
    owner: text("owner", {
      enum: ["it", "admin", "finance", "hr", "manager"],
    }).notNull(),
    label: text("label").notNull(),
    /** Days relative to the date of joining; negative means before. */
    dueOffsetDays: integer("due_offset_days").notNull().default(0),
    status: text("status", { enum: ["pending", "done", "blocked", "waived"] })
      .notNull()
      .default("pending"),
    note: text("note"),
    completedBy: text("completed_by"),
    completedAt: text("completed_at"),
    sequence: integer("sequence").notNull().default(0),
  },
  (t) => [index("joiner_tasks_idx").on(t.joinerId)],
);

/**
 * Gapless employee-code sequences per company — FR-ONB-7.
 * A number is never reused, even if a joiner drops out after allocation.
 */
export const idSequences = pgTable(
  "id_sequences",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    prefix: text("prefix").notNull().default(""),
    width: integer("width").notNull().default(4),
    nextValue: integer("next_value").notNull().default(1),
    /** Optional branch-code segment between prefix and number. */
    includeBranchCode: boolean("include_branch_code")
      .notNull()
      .default(false),
  },
  (t) => [uniqueIndex("id_seq_company_idx").on(t.companyId)],
);

/* ---------------- exit & settlement ---------------- */

export const exitCases = pgTable(
  "exit_cases",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    exitType: text("exit_type", {
      enum: [
        "resignation",
        "termination",
        "termination_cause",
        "probation_termination",
        "abscondment",
        "retirement",
        "contract_end",
        "death_in_service",
      ],
    }).notNull(),
    resignationDate: text("resignation_date").notNull(),
    /** Agreed last working day. Frozen once HR accepts. */
    lastWorkingDay: text("last_working_day").notNull(),
    reason: text("reason"),
    status: text("status", {
      enum: [
        "submitted",
        "manager_approved",
        "accepted",
        "clearance",
        "settled",
        "withdrawn",
      ],
    })
      .notNull()
      .default("submitted"),
    noticeWaived: boolean("notice_waived")
      .notNull()
      .default(false),
    noticeWaiverReason: text("notice_waiver_reason"),
    noticeWaivedBy: text("notice_waived_by"),
    employerPaysNoticeInLieu: boolean("employer_pays_notice_in_lieu")
      .notNull()
      .default(false),
    gratuityForfeited: boolean("gratuity_forfeited")
      .notNull()
      .default(false),
    gratuityForfeitureReason: text("gratuity_forfeiture_reason"),
    rehireEligible: text("rehire_eligible", {
      enum: ["eligible", "review", "not_eligible"],
    }),
    rehireNote: text("rehire_note"),
    /* Who is taking this role on. Named while the leaver is still serving
       notice so the org chart can show the team's next manager rather
       than silently orphaning them on the last working day. */
    replacementEmployeeId: text("replacement_employee_id").references(
      () => employees.id,
    ),
    acceptedBy: text("accepted_by"),
    acceptedAt: text("accepted_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("exit_cases_employee_idx").on(t.employeeId)],
);

/** Departments clear in parallel, not in series. */
export const clearanceItems = pgTable(
  "clearance_items",
  {
    id: text("id").primaryKey(),
    exitCaseId: text("exit_case_id")
      .notNull()
      .references(() => exitCases.id),
    department: text("department", {
      enum: ["it", "admin", "finance", "manager", "hr"],
    }).notNull(),
    label: text("label").notNull(),
    status: text("status", {
      enum: ["pending", "cleared", "cleared_with_recovery", "waived"],
    })
      .notNull()
      .default("pending"),
    recoveryPaise: bigint("recovery_paise", { mode: "number" }).notNull().default(0),
    note: text("note"),
    resolvedBy: text("resolved_by"),
    resolvedAt: text("resolved_at"),
  },
  (t) => [index("clearance_exit_idx").on(t.exitCaseId)],
);

export const loans = pgTable(
  "loans",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    scheme: text("scheme").notNull(),
    principalPaise: bigint("principal_paise", { mode: "number" }).notNull(),
    outstandingPaise: bigint("outstanding_paise", { mode: "number" }).notNull(),
    instalmentPaise: bigint("instalment_paise", { mode: "number" }).notNull(),
    /** Basis points; 0 for an interest-free scheme. */
    interestBps: integer("interest_bps").notNull().default(0),
    status: text("status", { enum: ["active", "closed", "on_hold"] })
      .notNull()
      .default("active"),
    startedOn: text("started_on").notNull(),

    /* ---- §3.10 ---- */
    schemeId: text("scheme_id").references(() => loanSchemes.id),
    tenureMonths: integer("tenure_months").notNull().default(12),
    interestMethod: text("interest_method", {
      enum: ["interest_free", "flat", "reducing_balance"],
    })
      .notNull()
      .default("interest_free"),
    /** Instalments missed earlier that are still owed — never written off silently. */
    arrearsPaise: bigint("arrears_paise", { mode: "number" }).notNull().default(0),
    purpose: text("purpose"),
    guarantorName: text("guarantor_name"),
    disbursedOn: text("disbursed_on"),
    /** Recovery starts here, which may be later than the disbursement. */
    firstRecoveryYear: integer("first_recovery_year"),
    firstRecoveryMonth: integer("first_recovery_month"),
    holdUntil: text("hold_until"),
    holdReason: text("hold_reason"),
    closedOn: text("closed_on"),
    approvedBy: text("approved_by"),
    approvedAt: text("approved_at"),
  },
  (t) => [
    index("loans_employee_idx").on(t.employeeId),
    index("loans_status_idx").on(t.status),
  ],
);

/**
 * Loan schemes — FR-LOAN-1. Terms are configuration, so changing a rate
 * for new borrowers never disturbs a loan already running on the old one:
 * each loan carries its own method and rate.
 */
export const loanSchemes = pgTable(
  "loan_schemes",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    code: text("code").notNull(),
    label: text("label").notNull(),
    /** UI grouping only — an advance recovers exactly like any other loan. */
    category: text("category", { enum: ["loan", "advance"] })
      .notNull()
      .default("loan"),
    interestMethod: text("interest_method", {
      enum: ["interest_free", "flat", "reducing_balance"],
    })
      .notNull()
      .default("interest_free"),
    annualRateBps: integer("annual_rate_bps").notNull().default(0),
    maxPrincipalPaise: bigint("max_principal_paise", { mode: "number" }).notNull(),
    maxTenureMonths: integer("max_tenure_months").notNull(),
    minServiceMonths: integer("min_service_months").notNull().default(0),
    /** Cap on the instalment as a share of monthly gross, basis points. */
    maxInstalmentOfGrossBps: integer("max_instalment_of_gross_bps")
      .notNull()
      .default(3000),
    allowConcurrent: boolean("allow_concurrent")
      .notNull()
      .default(false),
    requiresGuarantor: boolean("requires_guarantor")
      .notNull()
      .default(false),
    /** Recovery must never take net pay below this. */
    minNetPayPaise: bigint("min_net_pay_paise", { mode: "number" }).notNull().default(0),
    foreclosureChargeBps: integer("foreclosure_charge_bps").notNull().default(0),
    active: boolean("active").notNull().default(true),
    effectiveFrom: text("effective_from").notNull(),
  },
  (t) => [uniqueIndex("loan_scheme_idx").on(t.companyId, t.code)],
);

/**
 * The amortisation, stored rather than recomputed. A schedule agreed with
 * an employee is a commitment; recomputing it later from changed scheme
 * terms would quietly rewrite what they signed.
 */
export const loanSchedules = pgTable(
  "loan_schedules",
  {
    id: text("id").primaryKey(),
    loanId: text("loan_id")
      .notNull()
      .references(() => loans.id),
    instalmentNo: integer("instalment_no").notNull(),
    dueYear: integer("due_year").notNull(),
    dueMonth: integer("due_month").notNull(),
    openingPaise: bigint("opening_paise", { mode: "number" }).notNull(),
    interestPaise: bigint("interest_paise", { mode: "number" }).notNull(),
    principalPaise: bigint("principal_paise", { mode: "number" }).notNull(),
    instalmentPaise: bigint("instalment_paise", { mode: "number" }).notNull(),
    closingPaise: bigint("closing_paise", { mode: "number" }).notNull(),
    status: text("status", { enum: ["due", "recovered", "partial", "skipped"] })
      .notNull()
      .default("due"),
    recoveredPaise: bigint("recovered_paise", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    uniqueIndex("loan_schedule_idx").on(t.loanId, t.instalmentNo),
    index("loan_schedule_due_idx").on(t.dueYear, t.dueMonth),
  ],
);

/**
 * Every movement on a loan, append-only. The outstanding balance on the
 * loan row is a cache of this ledger, and the two must reconcile.
 */
export const loanTransactions = pgTable(
  "loan_transactions",
  {
    id: text("id").primaryKey(),
    loanId: text("loan_id")
      .notNull()
      .references(() => loans.id),
    kind: text("kind", {
      enum: [
        "disbursement",
        "recovery",
        "prepayment",
        "interest_accrual",
        "hold",
        "resume",
        "waiver",
        "exit_recovery",
        "write_off",
      ],
    }).notNull(),
    /** Positive increases the balance, negative reduces it. */
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    balanceAfterPaise: bigint("balance_after_paise", { mode: "number" }).notNull(),
    periodYear: integer("period_year"),
    periodMonth: integer("period_month"),
    runId: text("run_id").references(() => payrollRuns.id),
    /**
     * Arrears on the loan immediately before this movement. Recorded so
     * that reversing a booking restores the exact prior position —
     * arrears sit outside the balance, so the ledger sum alone cannot
     * reconstruct them.
     */
    arrearsBeforePaise: bigint("arrears_before_paise", { mode: "number" }),
    basis: text("basis").notNull(),
    actor: text("actor").notNull(),
    at: text("at").notNull(),
  },
  (t) => [
    index("loan_txn_loan_idx").on(t.loanId),
    index("loan_txn_period_idx").on(t.periodYear, t.periodMonth),
  ],
);

/** Leave balance carried for encashment at exit. */
export const leaveBalances = pgTable(
  "leave_balances",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    leaveType: text("leave_type").notNull(),
    balanceDays: real("balance_days").notNull().default(0),
    encashable: boolean("encashable")
      .notNull()
      .default(true),
    asOf: text("as_of").notNull(),
  },
  (t) => [uniqueIndex("leave_balance_idx").on(t.employeeId, t.leaveType)],
);

export const fnfSettlements = pgTable(
  "fnf_settlements",
  {
    id: text("id").primaryKey(),
    exitCaseId: text("exit_case_id")
      .notNull()
      .references(() => exitCases.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    status: text("status", {
      enum: ["draft", "approved", "paid", "recoverable", "written_off"],
    })
      .notNull()
      .default("draft"),
    payablesPaise: bigint("payables_paise", { mode: "number" }).notNull(),
    recoveriesPaise: bigint("recoveries_paise", { mode: "number" }).notNull(),
    netPaise: bigint("net_paise", { mode: "number" }).notNull(),
    exemptPaise: bigint("exempt_paise", { mode: "number" }).notNull().default(0),
    /** Serialised settlement lines, so the statement is reproducible. */
    linesJson: text("lines_json").notNull(),
    preparedBy: text("prepared_by"),
    approvedBy: text("approved_by"),
    createdAt: text("created_at").notNull(),

    /* ---- §3.16 ---- */
    /** The separation tax computation, serialised for the statement. */
    taxJson: text("tax_json"),
    /** FR-PAY-21: release is gated on clearance unless overridden. */
    clearanceOverriddenBy: text("clearance_overridden_by"),
    clearanceOverrideReason: text("clearance_override_reason"),
    slaDays: integer("sla_days").notNull().default(45),
    releasedAt: text("released_at"),
    /** FR-PAY-20: a demand that is forgiven rather than collected. */
    writtenOffPaise: bigint("written_off_paise", { mode: "number" }).notNull().default(0),
    writeOffReason: text("write_off_reason"),
    writtenOffBy: text("written_off_by"),
    /** FR-PAY-18: the settlement this one replaces. */
    supersedesId: text("supersedes_id"),
    reopenReason: text("reopen_reason"),
  },
  (t) => [
    index("fnf_exit_idx").on(t.exitCaseId),
    index("fnf_status_idx").on(t.status),
  ],
);

/**
 * Money actually collected against a negative settlement — PRD §3.16,
 * FR-PAY-20. Separate rows rather than a running total, because "we
 * recovered some of it" needs to say when, how much and how.
 */
export const fnfRecoveries = pgTable(
  "fnf_recoveries",
  {
    id: text("id").primaryKey(),
    settlementId: text("settlement_id")
      .notNull()
      .references(() => fnfSettlements.id),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    method: text("method", {
      enum: ["bank_transfer", "cheque", "cash", "adjusted_against_dues"],
    }).notNull(),
    reference: text("reference"),
    receivedAt: text("received_at").notNull(),
    note: text("note"),
    recordedBy: text("recorded_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("fnf_recoveries_settlement_idx").on(t.settlementId)],
);

/**
 * ESIC coverage is decided at the start of a contribution period and then
 * persists to the end of it, regardless of later wage rises. Storing the
 * decision is what makes FR-STAT-3 correct across months rather than
 * re-derived (wrongly) from current wages each run.
 */
export const esicCoverage = pgTable(
  "esic_coverage",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    /** Financial year the period starts in, e.g. 2026 for Apr-26–Mar-27. */
    financialYear: integer("financial_year").notNull(),
    period: text("period", { enum: ["apr_sep", "oct_mar"] }).notNull(),
    covered: boolean("covered").notNull(),
    /** Wage the decision was made on, kept for audit. */
    decidedOnWagePaise: bigint("decided_on_wage_paise", { mode: "number" }).notNull(),
    decidedAt: text("decided_at").notNull(),
  },
  (t) => [
    uniqueIndex("esic_coverage_period_idx").on(
      t.employeeId,
      t.financialYear,
      t.period,
    ),
  ],
);

/* ---------------- identity & access ---------------- */

/**
 * Roles carry a compensation-visibility scope of their own (PRD FR-SET-7),
 * separate from what they can otherwise reach.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    /** scrypt hash — never the password itself. */
    passwordHash: text("password_hash").notNull(),
    role: text("role", {
      enum: ["admin", "payroll_manager", "hr_manager", "auditor", "employee"],
    }).notNull(),
    /** Null means every company in the tenant. */
    companyId: text("company_id").references(() => companies.id),
    /** Linked employee record, for self-service users. */
    employeeId: text("employee_id").references(() => employees.id),
    compensationScope: text("compensation_scope", {
      enum: ["none", "own", "company", "all"],
    })
      .notNull()
      .default("none"),
    active: boolean("active").notNull().default(true),
    lastLoginAt: text("last_login_at"),
    /**
     * A single-use link that lets somebody set their own first password.
     *
     * An account created for an employee has no password anybody knows:
     * it is seeded with an unusable hash and can only be opened through
     * this token. That is deliberately different from generating a
     * password and telling the administrator it — which leaves the
     * administrator knowing how to sign in as an employee, and leaves
     * the password sitting in whatever chat it was pasted into.
     */
    inviteToken: text("invite_token"),
    inviteTokenExpiresAt: text("invite_token_expires_at"),
    /** Null until they have chosen a password of their own. */
    passwordSetAt: text("password_set_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_invite_token_idx").on(t.inviteToken),
  ],
);

/** Server-side sessions, so a logout actually revokes access. */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Append-only. PRD FR-AUD-1: no role may edit or delete these rows. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    at: text("at").notNull(),
    actor: text("actor").notNull(),
    /** Role held at the time, which may not be the role held today. */
    actorRole: text("actor_role"),
    /** FR-AUD-1: an API change and a screen change are not the same event. */
    source: text("source", {
      enum: ["interface", "api", "import", "automation"],
    })
      .notNull()
      .default("interface"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: text("before"),
    after: text("after"),
    reason: text("reason"),
    /** Rows a single event touched, so a bulk change is visible as one. */
    affectedCount: integer("affected_count"),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entity, t.entityId),
    index("audit_log_actor_idx").on(t.actor),
    index("audit_log_at_idx").on(t.at),
  ],
);

/* ==================================================================
   Income tax and TDS — PRD §3.9
   ================================================================== */

/**
 * One row per employee per financial year: the regime election and the
 * declared investments behind the projection. Amounts are what the
 * employee *claims*; what survives verification lives on taxProofs.
 */
export const taxDeclarations = pgTable(
  "tax_declarations",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    financialYear: integer("financial_year").notNull(),
    regime: text("regime", { enum: ["old", "new"] }).notNull().default("new"),
    /** Locked once the year's proof window closes — FR-TAX-2. */
    regimeLocked: boolean("regime_locked")
      .notNull()
      .default(false),

    section80cPaise: bigint("section_80c_paise", { mode: "number" }).notNull().default(0),
    section80ccd1bPaise: bigint("section_80ccd1b_paise", { mode: "number" }).notNull().default(0),
    section80dSelfPaise: bigint("section_80d_self_paise", { mode: "number" }).notNull().default(0),
    section80dParentsPaise: bigint("section_80d_parents_paise", { mode: "number" }).notNull().default(0),
    selfOrFamilyIsSenior: boolean("self_or_family_is_senior")
      .notNull()
      .default(false),
    parentsAreSenior: boolean("parents_are_senior")
      .notNull()
      .default(false),
    section80ePaise: bigint("section_80e_paise", { mode: "number" }).notNull().default(0),
    section80gPaise: bigint("section_80g_paise", { mode: "number" }).notNull().default(0),
    savingsInterestPaise: bigint("savings_interest_paise", { mode: "number" }).notNull().default(0),
    taxpayerIsSenior: boolean("taxpayer_is_senior")
      .notNull()
      .default(false),
    homeLoanInterestPaise: bigint("home_loan_interest_paise", { mode: "number" }).notNull().default(0),
    isSelfOccupied: boolean("is_self_occupied")
      .notNull()
      .default(true),

    /* House rent — FR-TAX-3. Rent is annual; the city decides 40 vs 50%. */
    annualRentPaise: bigint("annual_rent_paise", { mode: "number" }).notNull().default(0),
    rentCity: text("rent_city"),
    landlordName: text("landlord_name"),
    landlordPan: text("landlord_pan"),

    /* Previous employer — FR-TAX-5, from Form 12B. */
    previousEmployerName: text("previous_employer_name"),
    previousSalaryPaise: bigint("previous_salary_paise", { mode: "number" }).notNull().default(0),
    previousTdsPaise: bigint("previous_tds_paise", { mode: "number" }).notNull().default(0),
    previousPtPaise: bigint("previous_pt_paise", { mode: "number" }).notNull().default(0),

    /** Extra tax the employee asks to have deducted each month. */
    voluntaryMonthlyPaise: bigint("voluntary_monthly_paise", { mode: "number" }).notNull().default(0),

    status: text("status", {
      enum: ["draft", "submitted", "proofs_pending", "verified", "locked"],
    })
      .notNull()
      .default("draft"),
    submittedAt: text("submitted_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("tax_decl_idx").on(t.employeeId, t.financialYear),
    index("tax_decl_fy_idx").on(t.financialYear, t.status),
  ],
);

/**
 * The verification queue. One row per section per employee: what was
 * declared, what was evidenced, and who decided. Anything unverified when
 * the window closes drops out of the projection.
 */
export const taxProofs = pgTable(
  "tax_proofs",
  {
    id: text("id").primaryKey(),
    declarationId: text("declaration_id")
      .notNull()
      .references(() => taxDeclarations.id),
    section: text("section").notNull(),
    declaredPaise: bigint("declared_paise", { mode: "number" }).notNull(),
    verifiedPaise: bigint("verified_paise", { mode: "number" }).notNull().default(0),
    documentRef: text("document_ref"),
    status: text("status", {
      enum: ["pending", "verified", "partial", "rejected"],
    })
      .notNull()
      .default("pending"),
    note: text("note"),
    decidedBy: text("decided_by"),
    decidedAt: text("decided_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("tax_proof_idx").on(t.declarationId, t.section),
    index("tax_proof_status_idx").on(t.status),
  ],
);

/** Valued perquisites — FR-TAX-6. The basis string is kept for the worksheet. */
export const taxPerquisites = pgTable(
  "tax_perquisites",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    financialYear: integer("financial_year").notNull(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    valuePaise: bigint("value_paise", { mode: "number" }).notNull(),
    basis: text("basis").notNull(),
    /** Serialised inputs, so a valuation can be re-derived and audited. */
    inputs: text("inputs"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("tax_perq_idx").on(t.employeeId, t.financialYear),
  ],
);

/**
 * The monthly TDS actually deducted, by run. Kept separately from the
 * payroll line so a recomputed projection can credit what has already
 * gone to the department without re-reading every payslip.
 */
export const tdsLedger = pgTable(
  "tds_ledger",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    financialYear: integer("financial_year").notNull(),
    month: integer("month").notNull(),
    tdsPaise: bigint("tds_paise", { mode: "number" }).notNull(),
    /** Tax configuration set used, for FR-AUD-2 reproducibility. */
    configVersion: text("config_version").notNull(),
    runId: text("run_id").references(() => payrollRuns.id),
    computedAt: text("computed_at").notNull(),
  },
  (t) => [
    uniqueIndex("tds_ledger_idx").on(t.employeeId, t.financialYear, t.month),
  ],
);


/* ==================================================================
   Statutory filings — PRD §3.12 FR-STAT-5
   ================================================================== */

/**
 * Tracks a filing through the compliance calendar. The calendar itself is
 * derived, not stored — what is stored is only what a person did about
 * each item, keyed so the status survives the calendar being recomputed.
 */
export const statutoryFilings = pgTable(
  "statutory_filings",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    /** kind:state:year:month — see filingKey() in lib/statutory/calendar. */
    filingKey: text("filing_key").notNull(),
    kind: text("kind").notNull(),
    stateCode: text("state_code"),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    status: text("status", {
      enum: ["not_started", "in_progress", "filed"],
    })
      .notNull()
      .default("not_started"),
    /** The acknowledgement number the portal returned. */
    filingReference: text("filing_reference"),
    owner: text("owner"),
    amountPaise: bigint("amount_paise", { mode: "number" }),
    filedAt: text("filed_at"),
    note: text("note"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("statutory_filing_idx").on(t.companyId, t.filingKey),
    index("statutory_filing_period_idx").on(t.periodYear, t.periodMonth),
  ],
);


/* ==================================================================
   Banking, GL & accounting — PRD §3.14
   ================================================================== */

/**
 * An employee's bank accounts. Separate from the single account on the
 * employee record because net pay can be split — FR-BANK-2 — and a split
 * needs somewhere to say how much goes where.
 */
export const employeeBankAccounts = pgTable(
  "employee_bank_accounts",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    accountNumber: text("account_number").notNull(),
    ifsc: text("ifsc").notNull(),
    accountHolderName: text("account_holder_name").notNull(),
    bankName: text("bank_name"),
    /** remainder | fixed | percent — see lib/banking/payments. */
    allocationKind: text("allocation_kind", {
      enum: ["remainder", "fixed", "percent"],
    })
      .notNull()
      .default("remainder"),
    allocationValue: bigint("allocation_value", { mode: "number" }).notNull().default(0),
    sequence: integer("sequence").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [index("emp_bank_accounts_idx").on(t.employeeId)],
);

/** Per-company chart of accounts — FR-BANK-5. */
export const glAccounts = pgTable(
  "gl_accounts",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    accountType: text("account_type", {
      enum: ["expense", "liability", "asset"],
    }).notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("gl_account_idx").on(t.companyId, t.code)],
);

/** Which ledger accounts a payroll component posts to — FR-BANK-5. */
export const glMappings = pgTable(
  "gl_mappings",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    componentCode: text("component_code").notNull(),
    debitAccount: text("debit_account"),
    creditAccount: text("credit_account"),
  },
  (t) => [uniqueIndex("gl_mapping_idx").on(t.companyId, t.componentCode)],
);

/**
 * A generated disbursement file. Regenerating after a run changes marks
 * the earlier file superseded rather than leaving two in circulation —
 * FR-BANK-1 is explicit about this, and it is the difference between a
 * duplicate salary payment and none.
 */
export const bankFiles = pgTable(
  "bank_files",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    runId: text("run_id")
      .notNull()
      .references(() => payrollRuns.id),
    /** Which of the company's accounts the money leaves from. */
    bankAccountId: text("bank_account_id").references(() => bankAccounts.id),
    format: text("format").notNull(),
    reference: text("reference").notNull(),
    valueDate: text("value_date").notNull(),
    lineCount: integer("line_count").notNull(),
    totalPaise: bigint("total_paise", { mode: "number" }).notNull(),
    status: text("status", { enum: ["active", "superseded", "released"] })
      .notNull()
      .default("active"),
    supersededBy: text("superseded_by"),
    supersededReason: text("superseded_reason"),
    generatedBy: text("generated_by").notNull(),
    generatedAt: text("generated_at").notNull(),
  },
  (t) => [
    index("bank_files_run_idx").on(t.runId),
    index("bank_files_status_idx").on(t.status),
  ],
);

/** One instructed payment, so a bank response can be matched back to it. */
export const paymentInstructions = pgTable(
  "payment_instructions",
  {
    id: text("id").primaryKey(),
    bankFileId: text("bank_file_id")
      .notNull()
      .references(() => bankFiles.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    accountNumber: text("account_number").notNull(),
    ifsc: text("ifsc").notNull(),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    sameBank: boolean("same_bank").notNull().default(false),
    status: text("status", {
      enum: ["pending", "paid", "returned", "failed"],
    })
      .notNull()
      .default("pending"),
    failureReason: text("failure_reason"),
    /** A failed payment is re-queued rather than written off. */
    requeued: boolean("requeued").notNull().default(false),
    respondedAt: text("responded_at"),
  },
  (t) => [
    index("payment_instructions_file_idx").on(t.bankFileId),
    index("payment_instructions_status_idx").on(t.status),
  ],
);

/**
 * Monthly provision balances — FR-BANK-7. Stored per employee per kind so
 * that next month's opening balance is last month's closing, and the
 * charge that posts is the movement rather than the whole liability.
 */
export const provisionBalances = pgTable(
  "provision_balances",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    kind: text("kind", {
      enum: ["gratuity", "leave_encashment", "bonus"],
    }).notNull(),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    openingPaise: bigint("opening_paise", { mode: "number" }).notNull(),
    closingPaise: bigint("closing_paise", { mode: "number" }).notNull(),
    chargePaise: bigint("charge_paise", { mode: "number" }).notNull(),
    basis: text("basis").notNull(),
    computedAt: text("computed_at").notNull(),
  },
  (t) => [
    uniqueIndex("provision_idx").on(
      t.employeeId,
      t.kind,
      t.periodYear,
      t.periodMonth,
    ),
  ],
);

/** What was exported to an accounting system, so a re-send is deliberate. */
export const journalExports = pgTable(
  "journal_exports",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    runId: text("run_id")
      .notNull()
      .references(() => payrollRuns.id),
    target: text("target", { enum: ["tally_xml", "journal_csv"] }).notNull(),
    dimension: text("dimension").notNull(),
    totalDebitPaise: bigint("total_debit_paise", { mode: "number" }).notNull(),
    totalCreditPaise: bigint("total_credit_paise", { mode: "number" }).notNull(),
    exportedBy: text("exported_by").notNull(),
    exportedAt: text("exported_at").notNull(),
  },
  (t) => [index("journal_exports_run_idx").on(t.runId)],
);


/* ==================================================================
   Payroll audit & controls — PRD §3.15
   ================================================================== */

/**
 * Reads of compensation and bank data — FR-AUD-6. Writes are covered by
 * the audit log; this is the other half, because who *looked* at whose
 * salary is its own question in an investigation.
 */
export const accessLog = pgTable(
  "access_log",
  {
    id: text("id").primaryKey(),
    at: text("at").notNull(),
    actor: text("actor").notNull(),
    actorRole: text("actor_role"),
    /** compensation | bank | tax */
    dataClass: text("data_class", {
      enum: ["compensation", "bank", "tax"],
    }).notNull(),
    /** The screen, export or endpoint the read came through. */
    surface: text("surface").notNull(),
    companyId: text("company_id").references(() => companies.id),
    /** Null for a list view; set when one person's record was opened. */
    subjectEmployeeId: text("subject_employee_id").references(() => employees.id),
    /** Rows returned, so a bulk export is distinguishable from a lookup. */
    rowCount: integer("row_count").notNull().default(1),
    /** The filter applied, for an export. */
    filterApplied: text("filter_applied"),
  },
  (t) => [
    index("access_log_at_idx").on(t.at),
    index("access_log_actor_idx").on(t.actor),
    index("access_log_subject_idx").on(t.subjectEmployeeId),
  ],
);

/** Sensitive-change alerts raised to a control owner — FR-AUD-5. */
export const controlAlerts = pgTable(
  "control_alerts",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").references(() => companies.id),
    kind: text("kind").notNull(),
    severity: text("severity", { enum: ["high", "medium"] }).notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    actor: text("actor").notNull(),
    raisedAt: text("raised_at").notNull(),
    entityId: text("entity_id"),
    /** Acknowledgement is a person saying they looked, with a note. */
    acknowledgedBy: text("acknowledged_by"),
    acknowledgedAt: text("acknowledged_at"),
    acknowledgementNote: text("acknowledgement_note"),
  },
  (t) => [
    index("control_alerts_raised_idx").on(t.raisedAt),
    index("control_alerts_ack_idx").on(t.acknowledgedAt),
  ],
);

/** Suspends deletion during a dispute — FR-AUD-8. */
export const legalHolds = pgTable(
  "legal_holds",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    /** Null means the hold covers everyone. */
    employeeId: text("employee_id").references(() => employees.id),
    /** Null means the hold covers every period. */
    periodYear: integer("period_year"),
    reason: text("reason").notNull(),
    placedBy: text("placed_by").notNull(),
    placedAt: text("placed_at").notNull(),
    releasedBy: text("released_by"),
    releasedAt: text("released_at"),
    releaseReason: text("release_reason"),
  },
  (t) => [index("legal_holds_employee_idx").on(t.employeeId)],
);

/**
 * Segregation-of-duties policy per company — FR-AUD-4 says these are
 * configurable but on by default.
 */
export const sodPolicies = pgTable(
  "sod_policies",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    rule: text("rule").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    coolingDays: integer("cooling_days"),
    updatedBy: text("updated_by"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("sod_policy_idx").on(t.companyId, t.rule)],
);

/* ==================================================================
   Workflow engine — PRD §3.17
   ================================================================== */

/**
 * A template is data, interpreted by lib/workflow/engine. Steps are kept
 * as JSON rather than rows because a template is edited as one thing and
 * versioned as one thing — an instance records the version it ran on.
 */
export const workflowTemplates = pgTable(
  "workflow_templates",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    trigger: text("trigger").notNull(),
    stepsJson: text("steps_json").notNull(),
    version: integer("version").notNull().default(1),
    active: boolean("active").notNull().default(true),
    updatedBy: text("updated_by"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("workflow_template_idx").on(t.companyId, t.code)],
);

export const workflowInstances = pgTable(
  "workflow_instances",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => workflowTemplates.id),
    /** The template version this instance runs — later edits do not reach it. */
    templateVersion: integer("template_version").notNull(),
    /** A snapshot of the steps as they were when it started. */
    templateStepsJson: text("template_steps_json").notNull(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    subjectEmployeeId: text("subject_employee_id")
      .notNull()
      .references(() => employees.id),
    /** The record that triggered it, such as an exit case. */
    sourceEntity: text("source_entity").notNull(),
    sourceId: text("source_id").notNull(),
    status: text("status", {
      enum: ["running", "completed", "rejected", "cancelled"],
    })
      .notNull()
      .default("running"),
    stateJson: text("state_json").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (t) => [
    index("workflow_instance_status_idx").on(t.status),
    uniqueIndex("workflow_instance_source_idx").on(t.templateId, t.sourceEntity, t.sourceId),
  ],
);

/** The execution log, append-only in spirit and in use. */
export const workflowEvents = pgTable(
  "workflow_events",
  {
    id: text("id").primaryKey(),
    instanceId: text("instance_id")
      .notNull()
      .references(() => workflowInstances.id),
    at: text("at").notNull(),
    actor: text("actor").notNull(),
    stepKey: text("step_key"),
    message: text("message").notNull(),
  },
  (t) => [index("workflow_events_instance_idx").on(t.instanceId)],
);

/* ---------------- reporting, API & admin (§3.18) ---------------- */

/**
 * Read-only integration keys, scoped to one company — PRD §3.18 asks that
 * "permissions are scoped per company, so multi-entity tenants can
 * isolate payroll and employee data between legal entities" and that
 * applies as much to a machine caller as a person. Only the hash is
 * stored; the plaintext key is shown once, at creation.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    label: text("label").notNull(),
    displayPrefix: text("display_prefix").notNull(),
    hash: text("hash").notNull(),
    /** Whether this key may read compensation figures, separately from console roles. */
    compensationScope: text("compensation_scope", { enum: ["none", "company"] })
      .notNull()
      .default("none"),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedBy: text("revoked_by"),
    revokedAt: text("revoked_at"),
  },
  (t) => [
    uniqueIndex("api_keys_hash_idx").on(t.hash),
    index("api_keys_company_idx").on(t.companyId),
  ],
);

/** One subscriber endpoint, listening for a subset of the named event catalog. */
export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    url: text("url").notNull(),
    /** Used to sign every delivery; shown once, at creation. */
    secret: text("secret").notNull(),
    /** Comma-separated subset of WEBHOOK_EVENTS. */
    events: text("events").notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("webhook_subs_company_idx").on(t.companyId)],
);

/** One delivery attempt, kept whether it succeeded or not — the audit trail for outbound calls. */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => webhookSubscriptions.id),
    event: text("event").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status", { enum: ["delivered", "failed"] }).notNull(),
    responseStatus: integer("response_status"),
    responseSnippet: text("response_snippet"),
    attemptedAt: text("attempted_at").notNull(),
  },
  (t) => [
    index("webhook_deliveries_sub_idx").on(t.subscriptionId),
    index("webhook_deliveries_event_idx").on(t.event),
  ],
);

/* ---------------- assets ---------------- */

/**
 * Company-owned equipment issued to employees — laptops, phones, SIMs,
 * access cards. `status` is the asset's own state; who currently holds
 * it, if anyone, is derived from the open row (returnedAt is null) in
 * assetAllocations below, never stored redundantly here.
 */
export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    assetTag: text("asset_tag").notNull(),
    category: text("category", {
      enum: ["laptop", "desktop", "mobile", "sim", "access_card", "peripheral", "other"],
    }).notNull(),
    make: text("make"),
    model: text("model"),
    serialNumber: text("serial_number"),
    purchaseDate: text("purchase_date"),
    purchaseValuePaise: bigint("purchase_value_paise", { mode: "number" }),
    status: text("status", {
      enum: ["in_stock", "issued", "under_repair", "retired", "lost"],
    })
      .notNull()
      .default("in_stock"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("assets_company_tag_idx").on(t.companyId, t.assetTag),
    index("assets_company_idx").on(t.companyId),
    index("assets_status_idx").on(t.status),
  ],
);

/**
 * One row per issue-to-return cycle. `returnedAt` null means the asset
 * is with this employee right now — that is the only place "who holds
 * what" lives, so it can never drift from the asset's own status.
 */
export const assetAllocations = pgTable(
  "asset_allocations",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    issuedAt: text("issued_at").notNull(),
    issuedBy: text("issued_by").notNull(),
    issueCondition: text("issue_condition"),
    /** Null means the employee hasn't confirmed receipt yet — set by them, not by whoever issued it. */
    consentedAt: text("consented_at"),
    returnedAt: text("returned_at"),
    returnedBy: text("returned_by"),
    returnCondition: text("return_condition", {
      enum: ["good", "damaged", "lost"],
    }),
    notes: text("notes"),
  },
  (t) => [
    index("asset_allocations_asset_idx").on(t.assetId),
    index("asset_allocations_employee_idx").on(t.employeeId),
  ],
);
