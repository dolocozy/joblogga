import { Link, useNavigate } from 'react-router-dom'
import { createApplication } from '../api'
import ApplicationForm from '../components/ApplicationForm'

export default function NewApplication() {
  const navigate = useNavigate()
  return (
    <>
      <Link to="/" className="text-sm text-indigo-600 hover:underline">
        ← Back to applications
      </Link>
      <h1 className="text-2xl font-semibold text-slate-900 mt-2 mb-6">Add application</h1>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <ApplicationForm
          submitLabel="Add application"
          onSubmit={async (input) => {
            const created = await createApplication(input)
            navigate(`/applications/${created.id}`, { replace: true })
          }}
        />
      </div>
    </>
  )
}
