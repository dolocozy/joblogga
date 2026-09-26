import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { createApplication } from '../api'
import { blankApplication } from '../applicationDefaults'
import ApplicationForm from '../components/ApplicationForm'

export default function NewApplication() {
  const navigate = useNavigate()
  // The saved-jobs view links here with ?status=saved, to start on a job you have not applied to yet.
  const saving = useSearchParams()[0].get('status') === 'saved'
  return (
    <>
      <Link to="/applications" className="link text-sm">
        Back to applications
      </Link>
      <h1 className="mb-6 mt-3 text-3xl">{saving ? 'Save a job' : 'Add application'}</h1>
      <div className="sheet p-6">
        <ApplicationForm
          initial={blankApplication(saving ? 'saved' : 'applied')}
          submitLabel={saving ? 'Save job' : 'Add application'}
          onSubmit={async (input) => {
            const created = await createApplication(input)
            navigate(`/applications/${created.id}`, { replace: true })
          }}
        />
      </div>
    </>
  )
}
