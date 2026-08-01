/**
 * Emergency numbers by region and a seed list of hospitals & clinics.
 * Hospital data is illustrative — verify contact details before relying on them.
 */
export const emergencyNumbers = {
  uganda: { label: 'Uganda', emergency: '+256112', police: '999', ambulance: '911' },
  kenya: { label: 'Kenya', emergency: '999', ambulance: '911' },
  us: { label: 'United States', emergency: '911' },
  uk: { label: 'United Kingdom', emergency: '999', ambulance: '111' },
  eu: { label: 'European Union', emergency: '112' },
  india: { label: 'India', emergency: '112', ambulance: '108' },
  australia: { label: 'Australia', emergency: '000' },
}

export const seedHospitals = [
  {
    id: 'mulago',
    name: 'Mulago National Referral Hospital',
    city: 'Kampala, Uganda',
    phone: '+256414532062',
    type: 'Public referral hospital',
    address: 'Mulago Hill, Kampala',
  },
  {
    id: 'nakasero',
    name: 'Nakasero Hospital',
    city: 'Kampala, Uganda',
    phone: '+256312350400',
    type: 'Private hospital',
    address: 'Plot 14B, Prince Charles Drive, Nakasero',
  },
  {
    id: 'case',
    name: 'Case Medical Centre',
    city: 'Kampala, Uganda',
    phone: '+256414347827',
    type: 'Private hospital',
    address: 'Plot 41-45, Jinja Road, Kampala',
  },
  {
    id: 'ihk',
    name: 'International Hospital Kampala (IHK)',
    city: 'Kampala, Uganda',
    phone: '+256414200013',
    type: 'Private hospital',
    address: 'Plot 46-48, Nsamizi Road, Entebbe',
  },
  {
    id: 'lacor',
    name: 'St. Mary’s Hospital Lacor',
    city: 'Gulu, Uganda',
    phone: '+25647132000',
    type: 'Private not-for-profit hospital',
    address: 'Lacor, Gulu District',
  },
  {
    id: 'mbale',
    name: 'Mbale Regional Referral Hospital',
    city: 'Mbale, Uganda',
    phone: '+25645433749',
    type: 'Public referral hospital',
    address: 'Pallisa Road, Mbale',
  },
  {
    id: 'agakhan',
    name: 'Aga Khan University Hospital',
    city: 'Nairobi, Kenya',
    phone: '+254203669000',
    type: 'Private teaching hospital',
    address: 'Third Parklands Avenue, Nairobi',
  },
  {
    id: 'nairobi',
    name: 'The Nairobi Hospital',
    city: 'Nairobi, Kenya',
    phone: '+254207226000',
    type: 'Private hospital',
    address: 'Argwings Kodhek Road, Nairobi',
  },
]
