export interface User {
  id: string
  fullName: string
  email: string
  phone: string
  role: 'Patient' | 'Doctor' | 'Admin'
  photoURL: string
  createdAt: string
}

export interface PatientProfile {
  dob: string
  gender: string
  bloodGroup: string
  emergencyContact: string
  medicalHistory: string
  allergies: string
  medications: string
}

export interface Screening {
  id: string
  symptoms: string[]
  risk: string
  recommendations: string
  date: string
  status: string
}

export interface Appointment {
  id: string
  doctorId: string
  doctorName: string
  specialty: string
  patientId: string
  date: string
  time: string
  reason: string
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled'
  createdAt: Date
}

export interface EmergencyContact {
  id: string
  name: string
  phone: string
  relation: string
  createdAt: Date
}

export interface HealthRecord {
  id: string
  type: 'assessment' | 'checkIn' | 'appointment' | 'pregnancyNote' | 'emergencyContact'
  summary: string
  date: Date
  raw?: unknown
}
