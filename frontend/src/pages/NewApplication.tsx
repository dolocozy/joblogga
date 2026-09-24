import { Link, useNavigate } from 'react-router-dom'
import { createApplication } from '../api'
import ApplicationForm from '../components/ApplicationForm'

export default function NewApplication() {
  const navigate = useNavigate()
  return (
    <>
      <Link to="/applications" className="link text-sm">
        Back to applications
      </Link>
      <h1 className="mb-6 mt-3 text-3xl">Add application</h1>
      <div className="sheet p-6">
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
