export interface User { id: string; fullName: string; email: string; phone: string; role: 'Patient'|'Doctor'|'Admin'; photoURL: string; createdAt: string; }
export interface PatientProfile { dob: string; gender: string; bloodGroup: string; emergencyContact: string; medicalHistory: string; allergies: string; medications: string; }
export interface Screening { id: string; symptoms: string[]; risk: string; recommendations: string; date: string; status: string; }
export interface Appointment { id: string; doctorId: string; patientId: string; date: string; time: string; status: string; }
