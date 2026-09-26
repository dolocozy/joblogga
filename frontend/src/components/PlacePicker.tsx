import { useEffect, useState } from 'react'
import { fetchCountries, searchCities } from '../api'
import type { CityMatch, Country, PlaceRef } from '../api'
import { useDebounced } from '../hooks'
import { matchCountries } from '../placeSearch'
import Combobox from './Combobox'
import type { ComboOption } from './Combobox'
import Field from './Field'

// What the picker hands to the form to send.
export interface PlaceValue {
  country_id: number | null
  city_id: number | null
  location: string | null
}

// Where the picker starts: the country and city an application already has, and any typed text.
export interface InitialPlace {
  country: PlaceRef | null
  city: { id: number; label: string } | null // label is "Springfield, Illinois": the state is what tells places apart
  location: string | null
}

interface Props {
  idBase: string
  initial: InitialPlace
  onChange: (value: PlaceValue) => void
}

const cityOption = (m: CityMatch): ComboOption => ({ id: m.id, label: `${m.name}, ${m.state}` })

/**
 * Country, then city, from real place data. Choosing a city stores that exact row of the dataset (its state
 * comes with it, so there is no state box), and the list shows each city's state so two Springfields are two
 * different lines. Typing the place is still possible for anything missing, and says what that costs.
 */
export default function PlacePicker({ idBase, initial, onChange }: Props) {
  const [countries, setCountries] = useState<Country[] | null>(null)
  const [countriesFailed, setCountriesFailed] = useState(false)
  const [country, setCountry] = useState<ComboOption | null>(initial.country ? { id: initial.country.id, label: initial.country.name } : null)
  const [countryQuery, setCountryQuery] = useState('')

  const [city, setCity] = useState<ComboOption | null>(initial.city)
  const [cityQuery, setCityQuery] = useState('')
  const [cityOptions, setCityOptions] = useState<ComboOption[]>([])
  const [searching, setSearching] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)

  // A place that was typed (before places existed, or because it is missing) starts in typing mode.
  const [typing, setTyping] = useState(initial.city === null && !!initial.location)
  const [text, setText] = useState(initial.location ?? '')

  useEffect(() => {
    fetchCountries()
      .then(setCountries)
      .catch(() => setCountriesFailed(true))
  }, [])

  // Report what to send, whenever any part of the choice changes.
  useEffect(() => {
    if (typing) onChange({ country_id: country?.id ?? null, city_id: null, location: text.trim() || null })
    else onChange({ country_id: country?.id ?? null, city_id: city?.id ?? null, location: null })
    // onChange is the form's setter: including it would only re-report the same value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typing, text, country, city])

  const debouncedQuery = useDebounced(cityQuery.trim(), 250)
  useEffect(() => {
    if (!country || typing || debouncedQuery.length < 2) {
      setCityOptions([])
      return
    }
    let cancelled = false // a slow answer for an old query must not overwrite a newer one
    setSearching(true)
    setSearchFailed(false)
    searchCities(country.id, debouncedQuery)
      .then((matches) => {
        if (!cancelled) setCityOptions(matches.map(cityOption))
      })
      .catch(() => {
        if (!cancelled) {
          setCityOptions([])
          setSearchFailed(true)
        }
      })
      .finally(() => {
        if (!cancelled) setSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [country, typing, debouncedQuery])

  const countryOptions: ComboOption[] = matchCountries(countries ?? [], countryQuery).map((c) => ({ id: c.id, label: c.name }))

  return (
    <fieldset className="sm:col-span-2">
      <legend className="field-label mb-1">Location</legend>
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <Field id={`${idBase}-country`} label="Country">
          {(c) => (
            <Combobox
              control={c}
              options={countryOptions}
              selected={country}
              onInput={setCountryQuery}
              onSelect={(option) => {
                setCountry(option)
                setCity(null) // a city belongs to one country
                setCityQuery('')
              }}
              minChars={0}
              busy={countries === null && !countriesFailed}
              placeholder={countriesFailed ? 'Could not load countries' : 'Start typing a country'}
              disabled={countriesFailed}
              emptyText="No country by that name."
            />
          )}
        </Field>

        {typing ? (
          <Field
            id={`${idBase}-place`}
            label="Place, typed"
            hint="A typed place has no state or other structure, so two places with the same name can look identical. Pick from the list when you can."
          >
            {(c) => <input {...c} maxLength={200} value={text} onChange={(e) => setText(e.target.value)} className="input" />}
          </Field>
        ) : (
          <Field
            id={`${idBase}-city`}
            label="City"
            hint={searchFailed ? 'Could not search cities right now. You can type the place instead.' : country ? 'Its state is included, so places with the same name stay apart.' : 'Choose a country first.'}
          >
            {(c) => (
              <Combobox
                control={c}
                options={cityOptions}
                selected={city}
                onInput={setCityQuery}
                onSelect={setCity}
                minChars={2}
                busy={searching || cityQuery.trim() !== debouncedQuery}
                disabled={!country}
                placeholder={country ? 'Start typing a city' : 'Choose a country first'}
                emptyText="No city by that name in this country."
              />
            )}
          </Field>
        )}
      </div>

      <button type="button" onClick={() => setTyping((t) => !t)} className="link mt-2 text-sm">
        {typing ? 'Pick a city from the list instead' : "Can't find it? Type the place yourself"}
      </button>
    </fieldset>
  )
}
