/**
 * Shapes for the Places API (New) Text Search response, limited to the
 * fields we actually request via FieldMask. See lib/google/places.ts.
 */
export interface GooglePlaceAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

export interface GooglePlaceOpeningHours {
  openNow?: boolean;
  weekdayDescriptions?: string[];
}

export interface GooglePlace {
  id: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  addressComponents?: GooglePlaceAddressComponent[];
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  primaryType?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: GooglePlaceOpeningHours;
}

export interface GooglePlacesSearchResponse {
  places?: GooglePlace[];
  nextPageToken?: string;
}

/**
 * Business record shape produced by mapGooglePlaceToBusiness(), before it
 * is persisted to the `businesses` table.
 */
export interface NormalizedBusiness {
  googlePlaceId: string;
  businessName: string;
  category: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  websiteUrl: string | null;
  hasWebsite: boolean;
  rating: number | null;
  reviewCount: number | null;
  googleMapsUrl: string | null;
  openingHours: GooglePlaceOpeningHours | null;
  rawData: GooglePlace;
}
