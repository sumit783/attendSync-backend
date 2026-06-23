## Features in v1.0.0 🎉

The initial release established the core architectural foundation and primary API endpoints for AttendSync:

### 1. Secure Authentication & Authorization
- Robust JWT-based authentication for both Organizations and Employees.
- Secure OTP-based email verification and password reset flows using Nodemailer and Resend.
- Role-based route protection middleware.

### 2. Core Organization & Employee Management
- Complete CRUD endpoints for organizations to manage their employee directory.
- Dynamic organization configurations including geographical coordinates and base clock-in radius.

### 3. Attendance & Time Tracking
- Haversine-based geolocation validation for remote/on-site clock-ins.
- Intelligent daily attendance session management calculating total working hours automatically.
- Integrated background workers (Cron Jobs) to automatically mark absent employees at the end of shifts.

### 4. Dynamic Leave Management System
- Complete endpoints for employees to apply for various leave types (Sick, Vacation, Paid, Unpaid).
- Organization-facing routes to approve or reject pending leave applications.

### 5. QR Code Infrastructure
- Secure API to generate, validate, and expire daily dynamic QR codes for physical site clock-ins.
- Daily automated cron jobs to seamlessly refresh the organization's QR code token.