const fs = require('fs');
const path = require('path');

// ─── 1. Patch EmployeeHeader.tsx ─────────────────────────────────────────────
const headerPath = 'C:\\Users\\Admin\\Documents\\GitHub\\attendSync-organization\\src\\components\\employee\\EmployeeHeader.tsx';
let headerContent = fs.readFileSync(headerPath, 'utf8');

// Add onBulkUploadClick prop to interface
headerContent = headerContent.replace(
  `  onExportClick: () => void;\n}`,
  `  onExportClick: () => void;\n  onBulkUploadClick: () => void;\n}`
);

// Add Upload icon to imports
headerContent = headerContent.replace(
  `import { Plus as FiPlus, Download } from 'lucide-react';`,
  `import { Plus as FiPlus, Download, Upload } from 'lucide-react';`
);

// Add onBulkUploadClick to destructured props
headerContent = headerContent.replace(
  `export const EmployeeHeader = ({ isSuperAdmin, onAddClick, onExportClick }: EmployeeHeaderProps) => {`,
  `export const EmployeeHeader = ({ isSuperAdmin, onAddClick, onExportClick, onBulkUploadClick }: EmployeeHeaderProps) => {`
);

// Insert Bulk Upload button after the Export button
headerContent = headerContent.replace(
  `          <span>Export Attendance</span>\n        </button>\n\n        {!isSuperAdmin`,
  `          <span>Export Attendance</span>\n        </button>\n\n        <button\n          onClick={onBulkUploadClick}\n          className="hidden sm:inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold border border-violet-300 bg-violet-50/80 hover:bg-violet-100 text-violet-700 transition cursor-pointer shadow-2xs active:scale-95"\n        >\n          <Upload size={16} />\n          <span>Bulk Upload</span>\n        </button>\n\n        {!isSuperAdmin`
);

fs.writeFileSync(headerPath, headerContent, 'utf8');
console.log('✅ Patched EmployeeHeader.tsx');

// ─── 2. Patch OrgEmployees.tsx ────────────────────────────────────────────────
const empPath = 'C:\\Users\\Admin\\Documents\\GitHub\\attendSync-organization\\src\\pages\\Org\\OrgEmployees.tsx';
let empContent = fs.readFileSync(empPath, 'utf8');

// Add import for BulkAttendanceModal
empContent = empContent.replace(
  `import { ManualAttendanceModal } from '../../components/employee/ManualAttendanceModal';`,
  `import { ManualAttendanceModal } from '../../components/employee/ManualAttendanceModal';\nimport { BulkAttendanceModal } from '../../components/employee/BulkAttendanceModal';`
);

// Add state variables for bulk modal
empContent = empContent.replace(
  `  // Manual Attendance Modal state\n  const [isManualModalOpen, setIsManualModalOpen] = useState(false);\n  const [selectedAttendanceEmp, setSelectedAttendanceEmp] = useState<any>(null);`,
  `  // Manual Attendance Modal state\n  const [isManualModalOpen, setIsManualModalOpen] = useState(false);\n  const [selectedAttendanceEmp, setSelectedAttendanceEmp] = useState<any>(null);\n\n  // Bulk Attendance Modal state\n  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);`
);

// Add onBulkUploadClick prop to EmployeeHeader JSX
empContent = empContent.replace(
  `        onExportClick={() => setIsExportModalOpen(true)}\n      />`,
  `        onExportClick={() => setIsExportModalOpen(true)}\n        onBulkUploadClick={() => setIsBulkUploadOpen(true)}\n      />`
);

// Add BulkAttendanceModal JSX before EmployeeDetailsDialog
empContent = empContent.replace(
  `      {selectedEmp && (\n        <EmployeeDetailsDialog`,
  `      <BulkAttendanceModal\n        isOpen={isBulkUploadOpen}\n        onClose={() => setIsBulkUploadOpen(false)}\n        selectedCompanyId={selectedCompanyId && selectedCompanyId !== 'all' ? selectedCompanyId : undefined}\n        setBannerSuccess={setBannerSuccess}\n      />\n\n      {selectedEmp && (\n        <EmployeeDetailsDialog`
);

fs.writeFileSync(empPath, empContent, 'utf8');
console.log('✅ Patched OrgEmployees.tsx');

console.log('\nAll done!');
