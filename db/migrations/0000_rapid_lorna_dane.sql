CREATE TABLE "access_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" text NOT NULL,
	"actor" text NOT NULL,
	"actor_role" text,
	"data_class" text NOT NULL,
	"surface" text NOT NULL,
	"company_id" text,
	"subject_employee_id" text,
	"row_count" integer DEFAULT 1 NOT NULL,
	"filter_applied" text
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"label" text NOT NULL,
	"display_prefix" text NOT NULL,
	"hash" text NOT NULL,
	"compensation_scope" text DEFAULT 'none' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"last_used_at" text,
	"revoked_by" text,
	"revoked_at" text
);
--> statement-breakpoint
CREATE TABLE "asset_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"issued_at" text NOT NULL,
	"issued_by" text NOT NULL,
	"issue_condition" text,
	"consented_at" text,
	"returned_at" text,
	"returned_by" text,
	"return_condition" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"asset_tag" text NOT NULL,
	"category" text NOT NULL,
	"make" text,
	"model" text,
	"serial_number" text,
	"purchase_date" text,
	"purchase_value_paise" bigint,
	"status" text DEFAULT 'in_stock' NOT NULL,
	"notes" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_inputs" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"lop_days" real DEFAULT 0 NOT NULL,
	"overridden" boolean DEFAULT false NOT NULL,
	"overridden_by" text,
	"overridden_at" text,
	"override_reason" text
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"date" text NOT NULL,
	"punches_json" text DEFAULT '[]' NOT NULL,
	"day_type" text DEFAULT 'working' NOT NULL,
	"status" text NOT NULL,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"lop_units" real DEFAULT 0 NOT NULL,
	"basis" text,
	"regularised" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'derived' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" text NOT NULL,
	"actor" text NOT NULL,
	"actor_role" text,
	"source" text DEFAULT 'interface' NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" text,
	"after" text,
	"reason" text,
	"affected_count" integer
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"purpose" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_number" text NOT NULL,
	"ifsc" text NOT NULL,
	"file_format" text DEFAULT 'neft_generic' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_files" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"run_id" text NOT NULL,
	"bank_account_id" text,
	"format" text NOT NULL,
	"reference" text NOT NULL,
	"value_date" text NOT NULL,
	"line_count" integer NOT NULL,
	"total_paise" bigint NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"superseded_by" text,
	"superseded_reason" text,
	"generated_by" text NOT NULL,
	"generated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"address_line" text,
	"state_code" text NOT NULL,
	"city" text,
	"pincode" text,
	"cost_centre" text,
	"pt_reg_no" text,
	"lwf_reg_no" text,
	"pf_code_override" text,
	"esic_code_override" text,
	"lwf_applicable_override" boolean,
	"esic_implemented_area" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clearance_items" (
	"id" text PRIMARY KEY NOT NULL,
	"exit_case_id" text NOT NULL,
	"department" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"recovery_paise" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"resolved_by" text,
	"resolved_at" text
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"legal_name" text NOT NULL,
	"cin" text,
	"pan" text,
	"tan" text,
	"pf_code" text,
	"esic_code" text,
	"logo_url" text,
	"registered_address" text,
	"registered_city" text,
	"registered_state_code" text,
	"registered_pincode" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"proration_basis" text DEFAULT 'calendar_days' NOT NULL,
	"standard_days" integer DEFAULT 26 NOT NULL,
	"sandwich_rule" boolean DEFAULT false NOT NULL,
	"rounding_mode" text DEFAULT 'nearest' NOT NULL,
	"round_components" boolean DEFAULT false NOT NULL,
	"round_gross" boolean DEFAULT false NOT NULL,
	"round_net" boolean DEFAULT true NOT NULL,
	"epf_on_actual_basic" boolean DEFAULT false NOT NULL,
	"ot_rate_paise_per_hour" bigint,
	"pay_day_convention" text DEFAULT 'last_working_day' NOT NULL,
	"pay_day_of_month" integer DEFAULT 28 NOT NULL,
	"attendance_cutoff_day" integer DEFAULT 0 NOT NULL,
	"post_cutoff_treatment" text DEFAULT 'lag_to_next' NOT NULL,
	"retro_lop_treatment" text DEFAULT 'adjust_next_period' NOT NULL,
	"financial_year_start_month" integer DEFAULT 4 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_registrations" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"state_code" text NOT NULL,
	"kind" text NOT NULL,
	"registration_number" text NOT NULL,
	"secondary_number" text,
	"effective_from" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "control_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"actor" text NOT NULL,
	"raised_at" text NOT NULL,
	"entity_id" text,
	"acknowledged_by" text,
	"acknowledged_at" text,
	"acknowledgement_note" text
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"options" text,
	"required" boolean DEFAULT false NOT NULL,
	"section" text DEFAULT 'Additional' NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_values" (
	"id" text PRIMARY KEY NOT NULL,
	"definition_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"value" text
);
--> statement-breakpoint
CREATE TABLE "department_payroll_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"department_id" text NOT NULL,
	"proration_basis" text,
	"standard_days" integer,
	"rounding_mode" text,
	"round_components" boolean,
	"round_gross" boolean,
	"round_net" boolean,
	"updated_by" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "department_salary_structure_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"department_id" text NOT NULL,
	"structure_id" text NOT NULL,
	"updated_by" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"parent_id" text,
	"cost_centre" text,
	"approved_headcount" integer
);
--> statement-breakpoint
CREATE TABLE "employee_bank_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"account_number" text NOT NULL,
	"ifsc" text NOT NULL,
	"account_holder_name" text NOT NULL,
	"bank_name" text,
	"allocation_kind" text DEFAULT 'remainder' NOT NULL,
	"allocation_value" bigint DEFAULT 0 NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"doc_type" text NOT NULL,
	"label" text NOT NULL,
	"storage_ref" text,
	"issued_on" text,
	"expires_on" text,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_by" text,
	"restricted" boolean DEFAULT false NOT NULL,
	"uploaded_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_salaries" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"monthly_gross_paise" bigint NOT NULL,
	"structure_id" text,
	"annual_ctc_paise" bigint,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"reason" text,
	"revision_type" text DEFAULT 'initial' NOT NULL,
	"arrears_paise" bigint DEFAULT 0 NOT NULL,
	"approved_by" text,
	"created_by" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"emp_code" text NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"last_name" text NOT NULL,
	"email" text,
	"personal_email" text,
	"mobile" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"date_of_birth" text,
	"blood_group" text,
	"marital_status" text,
	"address_line" text,
	"city" text,
	"state_code" text,
	"pincode" text,
	"designation" text,
	"department" text,
	"department_id" text,
	"grade_id" text,
	"manager_id" text,
	"probation_end_date" text,
	"confirmation_date" text,
	"gender" text DEFAULT 'other' NOT NULL,
	"date_of_joining" text NOT NULL,
	"date_of_exit" text,
	"employment_type" text DEFAULT 'permanent' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"pan" text,
	"uan" text,
	"esic_ip" text,
	"had_prior_pf_membership" boolean DEFAULT false NOT NULL,
	"pf_opted_in" boolean DEFAULT true NOT NULL,
	"vpf_percent" real DEFAULT 0 NOT NULL,
	"tax_regime" text DEFAULT 'new' NOT NULL,
	"bank_account" text,
	"ifsc" text,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "esic_coverage" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"financial_year" integer NOT NULL,
	"period" text NOT NULL,
	"covered" boolean NOT NULL,
	"decided_on_wage_paise" bigint NOT NULL,
	"decided_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exit_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"exit_type" text NOT NULL,
	"resignation_date" text NOT NULL,
	"last_working_day" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"notice_waived" boolean DEFAULT false NOT NULL,
	"notice_waiver_reason" text,
	"notice_waived_by" text,
	"employer_pays_notice_in_lieu" boolean DEFAULT false NOT NULL,
	"gratuity_forfeited" boolean DEFAULT false NOT NULL,
	"gratuity_forfeiture_reason" text,
	"rehire_eligible" text,
	"rehire_note" text,
	"replacement_employee_id" text,
	"accepted_by" text,
	"accepted_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flexi_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"head_id" text NOT NULL,
	"claim_paise" bigint NOT NULL,
	"fare_paise" bigint,
	"bill_ref" text,
	"bill_date" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_paise" bigint DEFAULT 0 NOT NULL,
	"decision_note" text,
	"decided_by" text,
	"decided_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flexi_declarations" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"head_id" text NOT NULL,
	"annual_paise" bigint NOT NULL,
	"declared_under_regime" text DEFAULT 'new' NOT NULL,
	"submitted_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flexi_heads" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"exemption_basis" text NOT NULL,
	"annual_cap_paise" bigint,
	"statutory_annual_cap_paise" bigint,
	"min_annual_paise" bigint DEFAULT 0 NOT NULL,
	"available_in_new_regime" boolean DEFAULT false NOT NULL,
	"requires_proof" boolean DEFAULT true NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flexi_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"total_allocable_paise" bigint NOT NULL,
	"grade_id" text,
	"financial_year" integer NOT NULL,
	"declaration_opens_on" text NOT NULL,
	"declaration_closes_on" text NOT NULL,
	"claim_closes_on" text NOT NULL,
	"residual_payout_month" integer DEFAULT 2 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fnf_recoveries" (
	"id" text PRIMARY KEY NOT NULL,
	"settlement_id" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"received_at" text NOT NULL,
	"note" text,
	"recorded_by" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fnf_settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"exit_case_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payables_paise" bigint NOT NULL,
	"recoveries_paise" bigint NOT NULL,
	"net_paise" bigint NOT NULL,
	"exempt_paise" bigint DEFAULT 0 NOT NULL,
	"lines_json" text NOT NULL,
	"prepared_by" text,
	"approved_by" text,
	"created_at" text NOT NULL,
	"tax_json" text,
	"clearance_overridden_by" text,
	"clearance_override_reason" text,
	"sla_days" integer DEFAULT 45 NOT NULL,
	"released_at" text,
	"written_off_paise" bigint DEFAULT 0 NOT NULL,
	"write_off_reason" text,
	"written_off_by" text,
	"supersedes_id" text,
	"reopen_reason" text
);
--> statement-breakpoint
CREATE TABLE "gl_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"account_type" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gl_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"component_code" text NOT NULL,
	"debit_account" text,
	"credit_account" text
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"level" integer NOT NULL,
	"notice_days" integer,
	"probation_months" integer
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"branch_id" text,
	"date" text NOT NULL,
	"name" text NOT NULL,
	"restricted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "id_sequences" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"width" integer DEFAULT 4 NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"include_branch_code" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "joiner_declarations" (
	"id" text PRIMARY KEY NOT NULL,
	"joiner_id" text NOT NULL,
	"form" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" text,
	"submitted_at" text
);
--> statement-breakpoint
CREATE TABLE "joiner_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"joiner_id" text NOT NULL,
	"doc_type" text NOT NULL,
	"label" text NOT NULL,
	"category" text NOT NULL,
	"mandatory" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_ref" text,
	"rejection_reason" text,
	"uploaded_at" text,
	"reviewed_by" text,
	"reviewed_at" text,
	"sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "joiner_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"joiner_id" text NOT NULL,
	"owner" text NOT NULL,
	"label" text NOT NULL,
	"due_offset_days" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"completed_by" text,
	"completed_at" text,
	"sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "joiners" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"branch_id" text,
	"department_id" text,
	"grade_id" text,
	"manager_id" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"personal_email" text NOT NULL,
	"mobile" text,
	"designation" text,
	"employment_type" text DEFAULT 'permanent' NOT NULL,
	"offered_ctc_paise" bigint,
	"offered_monthly_gross_paise" bigint,
	"structure_id" text,
	"proposed_doj" text NOT NULL,
	"date_of_birth" text,
	"gender" text,
	"address_line" text,
	"city" text,
	"pincode" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"pan" text,
	"uan" text,
	"bank_account" text,
	"ifsc" text,
	"had_prior_pf_membership" boolean DEFAULT false NOT NULL,
	"portal_token" text NOT NULL,
	"portal_token_expires_at" text,
	"profile_submitted_at" text,
	"offer_status" text DEFAULT 'draft' NOT NULL,
	"offer_sent_at" text,
	"offer_responded_at" text,
	"acceptance_ip" text,
	"acceptance_user_agent" text,
	"bgv_status" text DEFAULT 'not_started' NOT NULL,
	"bgv_ref" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"converted_employee_id" text,
	"converted_at" text,
	"drop_reason" text,
	"created_by" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_exports" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"run_id" text NOT NULL,
	"target" text NOT NULL,
	"dimension" text NOT NULL,
	"total_debit_paise" bigint NOT NULL,
	"total_credit_paise" bigint NOT NULL,
	"exported_by" text NOT NULL,
	"exported_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jurisdictions" (
	"state_code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"pt_applicable" boolean NOT NULL,
	"lwf_applicable" boolean NOT NULL,
	"verification_note" text
);
--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"leave_type" text NOT NULL,
	"balance_days" real DEFAULT 0 NOT NULL,
	"encashable" boolean DEFAULT true NOT NULL,
	"as_of" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"leave_type_id" text NOT NULL,
	"from_date" text NOT NULL,
	"to_date" text NOT NULL,
	"days" real NOT NULL,
	"half_day" boolean DEFAULT false NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"lop_days" real DEFAULT 0 NOT NULL,
	"approver_id" text,
	"decided_by" text,
	"decided_at" text,
	"decision_note" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"annual_days" real DEFAULT 0 NOT NULL,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"paid" boolean DEFAULT true NOT NULL,
	"accrues_during_probation" boolean DEFAULT true NOT NULL,
	"carry_forward_cap" real DEFAULT 0 NOT NULL,
	"encashable" boolean DEFAULT false NOT NULL,
	"allow_negative" boolean DEFAULT false NOT NULL,
	"rounding" text DEFAULT 'none' NOT NULL,
	"restricted_holiday" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_holds" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text,
	"period_year" integer,
	"reason" text NOT NULL,
	"placed_by" text NOT NULL,
	"placed_at" text NOT NULL,
	"released_by" text,
	"released_at" text,
	"release_reason" text
);
--> statement-breakpoint
CREATE TABLE "loan_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"loan_id" text NOT NULL,
	"instalment_no" integer NOT NULL,
	"due_year" integer NOT NULL,
	"due_month" integer NOT NULL,
	"opening_paise" bigint NOT NULL,
	"interest_paise" bigint NOT NULL,
	"principal_paise" bigint NOT NULL,
	"instalment_paise" bigint NOT NULL,
	"closing_paise" bigint NOT NULL,
	"status" text DEFAULT 'due' NOT NULL,
	"recovered_paise" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_schemes" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"category" text DEFAULT 'loan' NOT NULL,
	"interest_method" text DEFAULT 'interest_free' NOT NULL,
	"annual_rate_bps" integer DEFAULT 0 NOT NULL,
	"max_principal_paise" bigint NOT NULL,
	"max_tenure_months" integer NOT NULL,
	"min_service_months" integer DEFAULT 0 NOT NULL,
	"max_instalment_of_gross_bps" integer DEFAULT 3000 NOT NULL,
	"allow_concurrent" boolean DEFAULT false NOT NULL,
	"requires_guarantor" boolean DEFAULT false NOT NULL,
	"min_net_pay_paise" bigint DEFAULT 0 NOT NULL,
	"foreclosure_charge_bps" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"effective_from" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"loan_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"balance_after_paise" bigint NOT NULL,
	"period_year" integer,
	"period_month" integer,
	"run_id" text,
	"arrears_before_paise" bigint,
	"basis" text NOT NULL,
	"actor" text NOT NULL,
	"at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"scheme" text NOT NULL,
	"principal_paise" bigint NOT NULL,
	"outstanding_paise" bigint NOT NULL,
	"instalment_paise" bigint NOT NULL,
	"interest_bps" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_on" text NOT NULL,
	"scheme_id" text,
	"tenure_months" integer DEFAULT 12 NOT NULL,
	"interest_method" text DEFAULT 'interest_free' NOT NULL,
	"arrears_paise" bigint DEFAULT 0 NOT NULL,
	"purpose" text,
	"guarantor_name" text,
	"disbursed_on" text,
	"first_recovery_year" integer,
	"first_recovery_month" integer,
	"hold_until" text,
	"hold_reason" text,
	"closed_on" text,
	"approved_by" text,
	"approved_at" text
);
--> statement-breakpoint
CREATE TABLE "lwf_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"state_code" text NOT NULL,
	"employee_paise" bigint NOT NULL,
	"employer_paise" bigint NOT NULL,
	"frequency" text NOT NULL,
	"deduction_months" text NOT NULL,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"verified" boolean DEFAULT false NOT NULL,
	"source" text
);
--> statement-breakpoint
CREATE TABLE "minimum_wages" (
	"id" text PRIMARY KEY NOT NULL,
	"state_code" text NOT NULL,
	"skill_category" text NOT NULL,
	"monthly_paise" bigint NOT NULL,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"verified" boolean DEFAULT false NOT NULL,
	"source" text
);
--> statement-breakpoint
CREATE TABLE "pay_components" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"calc_method" text DEFAULT 'fixed' NOT NULL,
	"percent_value" real DEFAULT 0 NOT NULL,
	"percent_of_code" text,
	"fixed_paise" bigint DEFAULT 0 NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"epf_base" boolean DEFAULT false NOT NULL,
	"esic_base" boolean DEFAULT true NOT NULL,
	"pt_base" boolean DEFAULT true NOT NULL,
	"bonus_base" boolean DEFAULT false NOT NULL,
	"gratuity_base" boolean DEFAULT false NOT NULL,
	"prorates" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_instructions" (
	"id" text PRIMARY KEY NOT NULL,
	"bank_file_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"account_number" text NOT NULL,
	"ifsc" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"same_bank" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"requeued" boolean DEFAULT false NOT NULL,
	"responded_at" text
);
--> statement-breakpoint
CREATE TABLE "payroll_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"kind" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"type_id" text,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"hours" real,
	"rate_paise_per_hour" bigint,
	"reason" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_calendars" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"attendance_cutoff" text NOT NULL,
	"input_freeze" text NOT NULL,
	"approval_deadline" text NOT NULL,
	"pay_date" text NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "payroll_employee_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"paid_days" real NOT NULL,
	"total_days" real NOT NULL,
	"lop_days" real DEFAULT 0 NOT NULL,
	"gross_paise" bigint NOT NULL,
	"deductions_paise" bigint NOT NULL,
	"employer_cost_paise" bigint NOT NULL,
	"net_paise" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"rule_type" text NOT NULL,
	"rule_value" text,
	"sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"category" text,
	"amount_paise" bigint NOT NULL,
	"basis" text,
	"sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"proration_basis" text NOT NULL,
	"config_snapshot" text,
	"prepared_by" text,
	"approved_by" text,
	"calculated_at" text,
	"approved_at" text,
	"reopen_reason" text,
	"supersedes_version" integer,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_change_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"field" text NOT NULL,
	"current_value" text,
	"requested_value" text NOT NULL,
	"reason" text,
	"document_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" text,
	"decision_note" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provision_balances" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"kind" text NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"opening_paise" bigint NOT NULL,
	"closing_paise" bigint NOT NULL,
	"charge_paise" bigint NOT NULL,
	"basis" text NOT NULL,
	"computed_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pt_slabs" (
	"id" text PRIMARY KEY NOT NULL,
	"state_code" text NOT NULL,
	"min_paise" bigint NOT NULL,
	"max_paise" bigint,
	"amount_paise" bigint NOT NULL,
	"override_month" integer,
	"override_amount_paise" bigint,
	"gender" text DEFAULT 'all' NOT NULL,
	"annual_cap_paise" bigint DEFAULT 250000 NOT NULL,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"verified" boolean DEFAULT false NOT NULL,
	"source" text
);
--> statement-breakpoint
CREATE TABLE "regularisation_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"date" text NOT NULL,
	"original_status" text NOT NULL,
	"original_punches_json" text DEFAULT '[]' NOT NULL,
	"requested_punches_json" text DEFAULT '[]' NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" text,
	"decision_note" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_structure_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"structure_id" text NOT NULL,
	"component_id" text NOT NULL,
	"calc_method_override" text,
	"percent_value_override" real,
	"fixed_paise_override" bigint,
	"sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_structures" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"min_basic_percent_of_gross" real DEFAULT 40 NOT NULL,
	"grade_id" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"effective_from" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"grace_minutes" integer DEFAULT 15 NOT NULL,
	"full_day_minutes" integer DEFAULT 480 NOT NULL,
	"half_day_minutes" integer DEFAULT 240 NOT NULL,
	"weekly_off_days" text DEFAULT '0' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sod_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"rule" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cooling_days" integer,
	"updated_by" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statutory_filings" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"filing_key" text NOT NULL,
	"kind" text NOT NULL,
	"state_code" text,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"filing_reference" text,
	"owner" text,
	"amount_paise" bigint,
	"filed_at" text,
	"note" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statutory_params" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" integer NOT NULL,
	"unit" text NOT NULL,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "tax_declarations" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"financial_year" integer NOT NULL,
	"regime" text DEFAULT 'new' NOT NULL,
	"regime_locked" boolean DEFAULT false NOT NULL,
	"section_80c_paise" bigint DEFAULT 0 NOT NULL,
	"section_80ccd1b_paise" bigint DEFAULT 0 NOT NULL,
	"section_80d_self_paise" bigint DEFAULT 0 NOT NULL,
	"section_80d_parents_paise" bigint DEFAULT 0 NOT NULL,
	"self_or_family_is_senior" boolean DEFAULT false NOT NULL,
	"parents_are_senior" boolean DEFAULT false NOT NULL,
	"section_80e_paise" bigint DEFAULT 0 NOT NULL,
	"section_80g_paise" bigint DEFAULT 0 NOT NULL,
	"savings_interest_paise" bigint DEFAULT 0 NOT NULL,
	"taxpayer_is_senior" boolean DEFAULT false NOT NULL,
	"home_loan_interest_paise" bigint DEFAULT 0 NOT NULL,
	"is_self_occupied" boolean DEFAULT true NOT NULL,
	"annual_rent_paise" bigint DEFAULT 0 NOT NULL,
	"rent_city" text,
	"landlord_name" text,
	"landlord_pan" text,
	"previous_employer_name" text,
	"previous_salary_paise" bigint DEFAULT 0 NOT NULL,
	"previous_tds_paise" bigint DEFAULT 0 NOT NULL,
	"previous_pt_paise" bigint DEFAULT 0 NOT NULL,
	"voluntary_monthly_paise" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_perquisites" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"financial_year" integer NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"value_paise" bigint NOT NULL,
	"basis" text NOT NULL,
	"inputs" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_proofs" (
	"id" text PRIMARY KEY NOT NULL,
	"declaration_id" text NOT NULL,
	"section" text NOT NULL,
	"declared_paise" bigint NOT NULL,
	"verified_paise" bigint DEFAULT 0 NOT NULL,
	"document_ref" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"decided_by" text,
	"decided_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tds_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"financial_year" integer NOT NULL,
	"month" integer NOT NULL,
	"tds_paise" bigint NOT NULL,
	"config_version" text NOT NULL,
	"run_id" text,
	"computed_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"company_id" text,
	"employee_id" text,
	"compensation_scope" text DEFAULT 'none' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variable_pay_types" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"category" text NOT NULL,
	"default_amount_paise" bigint,
	"system_managed" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"event" text NOT NULL,
	"payload_json" text NOT NULL,
	"status" text NOT NULL,
	"response_status" integer,
	"response_snippet" text,
	"attempted_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_events" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"at" text NOT NULL,
	"actor" text NOT NULL,
	"step_key" text,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"template_version" integer NOT NULL,
	"template_steps_json" text NOT NULL,
	"company_id" text NOT NULL,
	"subject_employee_id" text NOT NULL,
	"source_entity" text NOT NULL,
	"source_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"state_json" text NOT NULL,
	"started_at" text NOT NULL,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"steps_json" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_subject_employee_id_employees_id_fk" FOREIGN KEY ("subject_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_allocations" ADD CONSTRAINT "asset_allocations_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_allocations" ADD CONSTRAINT "asset_allocations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_inputs" ADD CONSTRAINT "attendance_inputs_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_files" ADD CONSTRAINT "bank_files_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_files" ADD CONSTRAINT "bank_files_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_files" ADD CONSTRAINT "bank_files_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance_items" ADD CONSTRAINT "clearance_items_exit_case_id_exit_cases_id_fk" FOREIGN KEY ("exit_case_id") REFERENCES "public"."exit_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_registrations" ADD CONSTRAINT "company_registrations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_alerts" ADD CONSTRAINT "control_alerts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_definition_id_custom_field_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."custom_field_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_payroll_overrides" ADD CONSTRAINT "department_payroll_overrides_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_payroll_overrides" ADD CONSTRAINT "department_payroll_overrides_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_salary_structure_overrides" ADD CONSTRAINT "department_salary_structure_overrides_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_salary_structure_overrides" ADD CONSTRAINT "department_salary_structure_overrides_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_salary_structure_overrides" ADD CONSTRAINT "department_salary_structure_overrides_structure_id_salary_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."salary_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_bank_accounts" ADD CONSTRAINT "employee_bank_accounts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_structure_id_salary_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."salary_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esic_coverage" ADD CONSTRAINT "esic_coverage_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_cases" ADD CONSTRAINT "exit_cases_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_cases" ADD CONSTRAINT "exit_cases_replacement_employee_id_employees_id_fk" FOREIGN KEY ("replacement_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flexi_claims" ADD CONSTRAINT "flexi_claims_plan_id_flexi_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."flexi_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flexi_claims" ADD CONSTRAINT "flexi_claims_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flexi_claims" ADD CONSTRAINT "flexi_claims_head_id_flexi_heads_id_fk" FOREIGN KEY ("head_id") REFERENCES "public"."flexi_heads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flexi_declarations" ADD CONSTRAINT "flexi_declarations_plan_id_flexi_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."flexi_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flexi_declarations" ADD CONSTRAINT "flexi_declarations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flexi_declarations" ADD CONSTRAINT "flexi_declarations_head_id_flexi_heads_id_fk" FOREIGN KEY ("head_id") REFERENCES "public"."flexi_heads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flexi_heads" ADD CONSTRAINT "flexi_heads_plan_id_flexi_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."flexi_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flexi_plans" ADD CONSTRAINT "flexi_plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flexi_plans" ADD CONSTRAINT "flexi_plans_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fnf_recoveries" ADD CONSTRAINT "fnf_recoveries_settlement_id_fnf_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."fnf_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD CONSTRAINT "fnf_settlements_exit_case_id_exit_cases_id_fk" FOREIGN KEY ("exit_case_id") REFERENCES "public"."exit_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD CONSTRAINT "fnf_settlements_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_mappings" ADD CONSTRAINT "gl_mappings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_sequences" ADD CONSTRAINT "id_sequences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joiner_declarations" ADD CONSTRAINT "joiner_declarations_joiner_id_joiners_id_fk" FOREIGN KEY ("joiner_id") REFERENCES "public"."joiners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joiner_documents" ADD CONSTRAINT "joiner_documents_joiner_id_joiners_id_fk" FOREIGN KEY ("joiner_id") REFERENCES "public"."joiners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joiner_tasks" ADD CONSTRAINT "joiner_tasks_joiner_id_joiners_id_fk" FOREIGN KEY ("joiner_id") REFERENCES "public"."joiners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joiners" ADD CONSTRAINT "joiners_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joiners" ADD CONSTRAINT "joiners_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joiners" ADD CONSTRAINT "joiners_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joiners" ADD CONSTRAINT "joiners_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joiners" ADD CONSTRAINT "joiners_manager_id_employees_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joiners" ADD CONSTRAINT "joiners_structure_id_salary_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."salary_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joiners" ADD CONSTRAINT "joiners_converted_employee_id_employees_id_fk" FOREIGN KEY ("converted_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_exports" ADD CONSTRAINT "journal_exports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_exports" ADD CONSTRAINT "journal_exports_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approver_id_employees_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_schedules" ADD CONSTRAINT "loan_schedules_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_schemes" ADD CONSTRAINT "loan_schemes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_transactions" ADD CONSTRAINT "loan_transactions_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_transactions" ADD CONSTRAINT "loan_transactions_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_scheme_id_loan_schemes_id_fk" FOREIGN KEY ("scheme_id") REFERENCES "public"."loan_schemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_components" ADD CONSTRAINT "pay_components_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_bank_file_id_bank_files_id_fk" FOREIGN KEY ("bank_file_id") REFERENCES "public"."bank_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_instructions" ADD CONSTRAINT "payment_instructions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_type_id_variable_pay_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."variable_pay_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_calendars" ADD CONSTRAINT "payroll_calendars_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_employee_summaries" ADD CONSTRAINT "payroll_employee_summaries_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_employee_summaries" ADD CONSTRAINT "payroll_employee_summaries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_groups" ADD CONSTRAINT "payroll_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_document_id_employee_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."employee_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provision_balances" ADD CONSTRAINT "provision_balances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provision_balances" ADD CONSTRAINT "provision_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regularisation_requests" ADD CONSTRAINT "regularisation_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structure_lines" ADD CONSTRAINT "salary_structure_lines_structure_id_salary_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."salary_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structure_lines" ADD CONSTRAINT "salary_structure_lines_component_id_pay_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."pay_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sod_policies" ADD CONSTRAINT "sod_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_filings" ADD CONSTRAINT "statutory_filings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_declarations" ADD CONSTRAINT "tax_declarations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_perquisites" ADD CONSTRAINT "tax_perquisites_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_proofs" ADD CONSTRAINT "tax_proofs_declaration_id_tax_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."tax_declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_ledger" ADD CONSTRAINT "tds_ledger_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_ledger" ADD CONSTRAINT "tds_ledger_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variable_pay_types" ADD CONSTRAINT "variable_pay_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."webhook_subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_template_id_workflow_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_subject_employee_id_employees_id_fk" FOREIGN KEY ("subject_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_log_at_idx" ON "access_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "access_log_actor_idx" ON "access_log" USING btree ("actor");--> statement-breakpoint
CREATE INDEX "access_log_subject_idx" ON "access_log" USING btree ("subject_employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "api_keys_company_idx" ON "api_keys" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "asset_allocations_asset_idx" ON "asset_allocations" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_allocations_employee_idx" ON "asset_allocations" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_company_tag_idx" ON "assets" USING btree ("company_id","asset_tag");--> statement-breakpoint
CREATE INDEX "assets_company_idx" ON "assets" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "assets_status_idx" ON "assets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_period_idx" ON "attendance_inputs" USING btree ("employee_id","period_year","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_emp_date_idx" ON "attendance_records" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "bank_accounts_company_idx" ON "bank_accounts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "bank_files_run_idx" ON "bank_files" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "bank_files_status_idx" ON "bank_files" USING btree ("status");--> statement-breakpoint
CREATE INDEX "branches_company_idx" ON "branches" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "clearance_exit_idx" ON "clearance_items" USING btree ("exit_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_reg_idx" ON "company_registrations" USING btree ("company_id","state_code","kind");--> statement-breakpoint
CREATE INDEX "company_reg_company_idx" ON "company_registrations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "control_alerts_raised_idx" ON "control_alerts" USING btree ("raised_at");--> statement-breakpoint
CREATE INDEX "control_alerts_ack_idx" ON "control_alerts" USING btree ("acknowledged_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cfd_company_code_idx" ON "custom_field_definitions" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "cfv_def_emp_idx" ON "custom_field_values" USING btree ("definition_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dept_payroll_override_idx" ON "department_payroll_overrides" USING btree ("company_id","department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dept_salary_structure_override_idx" ON "department_salary_structure_overrides" USING btree ("company_id","department_id");--> statement-breakpoint
CREATE INDEX "departments_company_idx" ON "departments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "emp_bank_accounts_idx" ON "employee_bank_accounts" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "emp_docs_employee_idx" ON "employee_documents" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_salaries_emp_idx" ON "employee_salaries" USING btree ("employee_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_company_code_idx" ON "employees" USING btree ("company_id","emp_code");--> statement-breakpoint
CREATE INDEX "employees_branch_idx" ON "employees" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "esic_coverage_period_idx" ON "esic_coverage" USING btree ("employee_id","financial_year","period");--> statement-breakpoint
CREATE INDEX "exit_cases_employee_idx" ON "exit_cases" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "flexi_claims_emp_idx" ON "flexi_claims" USING btree ("employee_id","plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flexi_decl_idx" ON "flexi_declarations" USING btree ("employee_id","head_id","plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flexi_head_idx" ON "flexi_heads" USING btree ("plan_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "flexi_plan_idx" ON "flexi_plans" USING btree ("company_id","code","financial_year");--> statement-breakpoint
CREATE INDEX "fnf_recoveries_settlement_idx" ON "fnf_recoveries" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "fnf_exit_idx" ON "fnf_settlements" USING btree ("exit_case_id");--> statement-breakpoint
CREATE INDEX "fnf_status_idx" ON "fnf_settlements" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "gl_account_idx" ON "gl_accounts" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "gl_mapping_idx" ON "gl_mappings" USING btree ("company_id","component_code");--> statement-breakpoint
CREATE UNIQUE INDEX "grades_company_name_idx" ON "grades" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "holidays_company_date_idx" ON "holidays" USING btree ("company_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "id_seq_company_idx" ON "id_sequences" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "joiner_decl_idx" ON "joiner_declarations" USING btree ("joiner_id","form");--> statement-breakpoint
CREATE INDEX "joiner_docs_idx" ON "joiner_documents" USING btree ("joiner_id");--> statement-breakpoint
CREATE INDEX "joiner_tasks_idx" ON "joiner_tasks" USING btree ("joiner_id");--> statement-breakpoint
CREATE INDEX "joiners_company_idx" ON "joiners" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "joiners_token_idx" ON "joiners" USING btree ("portal_token");--> statement-breakpoint
CREATE INDEX "journal_exports_run_idx" ON "journal_exports" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_balance_idx" ON "leave_balances" USING btree ("employee_id","leave_type");--> statement-breakpoint
CREATE INDEX "leave_requests_emp_idx" ON "leave_requests" USING btree ("employee_id","from_date");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_company_code_idx" ON "leave_types" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "legal_holds_employee_idx" ON "legal_holds" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "loan_schedule_idx" ON "loan_schedules" USING btree ("loan_id","instalment_no");--> statement-breakpoint
CREATE INDEX "loan_schedule_due_idx" ON "loan_schedules" USING btree ("due_year","due_month");--> statement-breakpoint
CREATE UNIQUE INDEX "loan_scheme_idx" ON "loan_schemes" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "loan_txn_loan_idx" ON "loan_transactions" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "loan_txn_period_idx" ON "loan_transactions" USING btree ("period_year","period_month");--> statement-breakpoint
CREATE INDEX "loans_employee_idx" ON "loans" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "loans_status_idx" ON "loans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lwf_rates_state_idx" ON "lwf_rates" USING btree ("state_code","effective_from");--> statement-breakpoint
CREATE INDEX "minimum_wages_state_idx" ON "minimum_wages" USING btree ("state_code","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_components_company_code_idx" ON "pay_components" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "payment_instructions_file_idx" ON "payment_instructions" USING btree ("bank_file_id");--> statement-breakpoint
CREATE INDEX "payment_instructions_status_idx" ON "payment_instructions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payroll_adjustments_period_idx" ON "payroll_adjustments" USING btree ("employee_id","period_year","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_calendar_idx" ON "payroll_calendars" USING btree ("company_id","period_year","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_summaries_run_emp_idx" ON "payroll_employee_summaries" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_groups_company_idx" ON "payroll_groups" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "payroll_lines_run_emp_idx" ON "payroll_lines" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_period_idx" ON "payroll_runs" USING btree ("company_id","period_year","period_month","version");--> statement-breakpoint
CREATE INDEX "profile_change_emp_idx" ON "profile_change_requests" USING btree ("employee_id","status");--> statement-breakpoint
CREATE INDEX "profile_change_status_idx" ON "profile_change_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "provision_idx" ON "provision_balances" USING btree ("employee_id","kind","period_year","period_month");--> statement-breakpoint
CREATE INDEX "pt_slabs_state_idx" ON "pt_slabs" USING btree ("state_code","effective_from");--> statement-breakpoint
CREATE INDEX "regularisation_emp_idx" ON "regularisation_requests" USING btree ("employee_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "structure_line_idx" ON "salary_structure_lines" USING btree ("structure_id","component_id");--> statement-breakpoint
CREATE INDEX "salary_structures_company_idx" ON "salary_structures" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_company_code_idx" ON "shifts" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "sod_policy_idx" ON "sod_policies" USING btree ("company_id","rule");--> statement-breakpoint
CREATE UNIQUE INDEX "statutory_filing_idx" ON "statutory_filings" USING btree ("company_id","filing_key");--> statement-breakpoint
CREATE INDEX "statutory_filing_period_idx" ON "statutory_filings" USING btree ("period_year","period_month");--> statement-breakpoint
CREATE INDEX "statutory_params_key_idx" ON "statutory_params" USING btree ("key","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_decl_idx" ON "tax_declarations" USING btree ("employee_id","financial_year");--> statement-breakpoint
CREATE INDEX "tax_decl_fy_idx" ON "tax_declarations" USING btree ("financial_year","status");--> statement-breakpoint
CREATE INDEX "tax_perq_idx" ON "tax_perquisites" USING btree ("employee_id","financial_year");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_proof_idx" ON "tax_proofs" USING btree ("declaration_id","section");--> statement-breakpoint
CREATE INDEX "tax_proof_status_idx" ON "tax_proofs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "tds_ledger_idx" ON "tds_ledger" USING btree ("employee_id","financial_year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "variable_pay_type_idx" ON "variable_pay_types" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_sub_idx" ON "webhook_deliveries" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_event_idx" ON "webhook_deliveries" USING btree ("event");--> statement-breakpoint
CREATE INDEX "webhook_subs_company_idx" ON "webhook_subscriptions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "workflow_events_instance_idx" ON "workflow_events" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "workflow_instance_status_idx" ON "workflow_instances" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_instance_source_idx" ON "workflow_instances" USING btree ("template_id","source_entity","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_template_idx" ON "workflow_templates" USING btree ("company_id","code");