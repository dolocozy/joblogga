import type { ReactNode } from 'react'

// Plain text, written from what the app does (the README has the detail behind each answer). To add a question, add an entry.
export const FAQS: { question: string; answer: ReactNode }[] = [
  {
    question: 'What is Joblogga, and who is it for?',
    answer:
      'Joblogga is a logbook for a job search: each application, where it stands, when you applied, which resume you sent and when to follow up. It is for people in the middle of a real search who are sending applications faster than they can remember them. It is open source, and was built during its author’s own job search.',
  },
  {
    question: 'Is my data private? Who can see my applications?',
    answer:
      'Only you. Every application belongs to one account, and the app only ever returns the applications of the account you are logged in to. Passwords are stored only as one-way hashes, and your email address is used to verify your account, to reset your password and, if you turn them on, to send reminders.',
  },
  {
    question: 'What do the statuses mean?',
    answer:
      'Saved is a job you have not applied to yet; it has no applied date and is left out of the dashboard figures until you mark it applied. Applied, Screening (a first conversation), Interview and Offer are the stages a live application moves through. An application ends as Offer accepted, Offer declined, Rejected (they said no) or Withdrawn (you pulled out). Declining an offer is its own status because it was your decision, so it is not counted as a rejection.',
  },
  {
    question: 'How is the response rate calculated?',
    answer:
      'It is the share of applications that got any reply: those that reached Screening, Interview, Offer (or an offer’s outcome) or Rejected. It is worked out from each application’s status history, so one that reached an interview and was later withdrawn still counts as answered. Applications you withdrew before hearing anything are left out of both sides, since that was your decision, and Saved jobs are not counted at all. With nothing to measure yet it shows a dash, not 0%.',
  },
  {
    question: 'How do follow-up reminders work, and how do I turn them off?',
    answer:
      'Reminders are off until you turn them on under “Email reminders” on the Account page. Once on, you get at most one email a day, around 13:07 UTC, listing your open applications whose follow-up date is today or has passed, and nothing is sent on a day when nothing is due. They go only to verified email addresses, and closed or archived applications are left out. To stop them, untick the box on the Account page or use the unsubscribe link in any reminder email, which works without logging in.',
  },
  {
    question: 'Can I import or export my data?',
    answer:
      'Yes, on the Account page. Export CSV downloads all your applications as a spreadsheet file, and Import reads a CSV back in: a file exported from Joblogga comes back as it was, and other spreadsheets work if the first row names the columns, with Company and Role required. A row with the same company and role as one you already have is left out by default, so importing the same file twice adds nothing. Rows that cannot be imported are skipped and listed with the reason, and values it cannot read, such as a date written 3/4/2026, are left empty and reported rather than guessed.',
  },
  {
    question: 'What does archiving do?',
    answer:
      'Archiving puts a closed application away without deleting it: it disappears from the default list and board and from reminders, and comes back through the archive filter above the list or with Unarchive. Archived applications still count in every dashboard figure and are included in the CSV export, so archiving never changes your history. Deleting an application is separate, and permanent.',
  },
  {
    question: 'What are tags, and why do they show in lower case?',
    answer:
      'Tags are your own labels, such as “referral” or “dream job”, separate from status; an application can have up to 10. They are saved in lower case with extra spaces collapsed, so “Dream Job” and “dream job” are one tag instead of two that never match. You can filter the list and board by tag, and the search box finds them too.',
  },
  {
    question: 'How do I delete my account, and what is deleted?',
    answer:
      'On the Account page, choose “Delete my account” and enter your password to confirm. This permanently deletes the account and everything in it: every application, with its status history, contacts and tags. There is no undo, so export your data first if you want a copy.',
  },
  {
    question: 'I did not get my verification or reset email. What now?',
    answer:
      'Check your spam folder first. For a verification email, log in (you can use Joblogga without verifying) and press “Resend email” in the banner at the top; the link works for 24 hours. For a password reset, ask for another link on the forgot-password page; it works for 30 minutes, and a new one replaces the old. Each address can only be sent a few of these an hour, so if you hit the limit, wait a little and try once more.',
  },
  {
    question: 'Why was my first login slow?',
    answer:
      'The app and its database run on free hosting that goes to sleep when nobody has used it for a while. The first request after a quiet spell can take up to a minute to wake it, and after that everything is quick. If a first login seems stuck, give it a moment before trying again.',
  },
  {
    question: 'Does it have a dark mode?',
    answer:
      'Yes. It follows your device’s light or dark setting by default, and the Theme button in the page header steps through System, Light and Dark to override that. The choice is saved in your browser only, so it is not shared between devices.',
  },
  {
    question: 'How do I report a problem or ask a question?',
    answer: (
      <>
        Open an issue on{' '}
        <a href="https://github.com/dolocozy/joblogga/issues" className="link" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        . Issues are public, so leave out anything private, such as your password or the contents of your applications.
      </>
    ),
  },
]
