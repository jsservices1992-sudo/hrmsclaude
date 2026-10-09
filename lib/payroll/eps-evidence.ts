export function epsEvidenceNeedsReview(employee: {
  epsApplicability: string; epsMember: boolean | null;
  epsJoiningWagePaise: number | null; epsRevisionWagePaise: number | null;
  dateOfJoining: string;
}, asOf: string) {
  return (employee.epsApplicability === "auto" && employee.epsMember !== true && employee.epsJoiningWagePaise == null
    && !(asOf >= "2026-09-17" && employee.epsRevisionWagePaise != null && employee.epsRevisionWagePaise <= 2500000))
    || (asOf >= "2026-09-17" && employee.dateOfJoining < "2026-09-17"
      && employee.epsMember !== true && employee.epsApplicability !== "yes" && employee.epsRevisionWagePaise == null);
}
