# AttendSync Backend

AttendSync is a comprehensive attendance and employee management backend API.

## What's New in v1.1.0 🚀

### 1. Robust Automated Testing
- Introduced a full testing suite using **Jest** and **Supertest**.
- Integrated `mongodb-memory-server` to run tests in an isolated, in-memory environment, preventing corruption of the live database.
- Full test coverage added for Organization Authentication and Scheduling endpoints.

### 2. Enhanced Schedule Enforcement
- The clock-in system now strictly verifies an employee's assigned schedule.
- Employees are actively blocked from clocking in on non-working days or if they lack an assigned schedule.

### 3. Smarter Geolocation & Alerts
- Evaluates clock-in distances precisely in **meters**.
- **Location Alerts**: If an employee attempts to clock in/out from beyond the organization's allowed geofence radius, the action is blocked and a real-time `'LocationAlert'` notification is dispatched to the organization.

### 4. Work From Home (WFH) Integration
- `'Work From Home'` is now an officially recognized leave type.
- **Smart Geofence Bypass**: If an employee has an approved WFH request for the current day, the system intelligently bypasses the standard geolocation restrictions, allowing them to clock in seamlessly from home.
- **Strict Leave Blocking**: Conversely, if an employee has an approved regular leave (like Sick Leave or Vacation), the system entirely blocks them from clocking in for that day.

---

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