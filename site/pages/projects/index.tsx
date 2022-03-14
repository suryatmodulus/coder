import React from "react"
import { makeStyles } from "@material-ui/core/styles"
import Paper from "@material-ui/core/Paper"
import { Link, Navigate, useLocation } from "react-router-dom"
import { EmptyState } from "../../components"
import { ErrorSummary } from "../../components/ErrorSummary"
import { Navbar } from "../../components/Navbar"
import { Header } from "../../components/Header"
import { Footer } from "../../components/Page"
import { Column, Table } from "../../components/Table"
import { FullScreenLoader } from "../../components/Loader/FullScreenLoader"

import { Organization, Project } from "./../../api"
import useSWR from "swr"
import { CodeExample } from "../../components/CodeExample/CodeExample"
import { useActor } from "@xstate/react"
import { userService } from "../../services/user/userService"

const ProjectsPage: React.FC = () => {
  const styles = useStyles()
  const location = useLocation()
  const [userState, userSend] = useActor(userService)
  const { error: userError, me } = userState.context
  const { data: orgs, error: orgsError } = useSWR<Organization[], Error>("/api/v2/users/me/organizations")
  const { data: projects, error } = useSWR<Project[] | null, Error>(
    orgs ? `/api/v2/organizations/${orgs[0].id}/projects` : null,
  )

  if (userState.matches("signedOut")) {
    return <Navigate to={"/login?redirect=" + encodeURIComponent(location.pathname)} />
  }

  if (userError) {
    return <ErrorSummary error={error} />
  }

  if (orgsError) {
    return <ErrorSummary error={error} />
  }

  if (!me || !projects || !orgs) {
    return <FullScreenLoader />
  }

  // Create a dictionary of organization ID -> organization Name
  // Needed to properly construct links to dive into a project
  const orgDictionary = orgs.reduce((acc: Record<string, string>, curr: Organization) => {
    return {
      ...acc,
      [curr.id]: curr.name,
    }
  }, {})

  const columns: Column<Project>[] = [
    {
      key: "name",
      name: "Name",
      renderer: (nameField: string, data: Project) => {
        return <Link to={`/projects/${orgDictionary[data.organization_id]}/${nameField}`}>{nameField}</Link>
      },
    },
  ]

  const description = (
    <div>
      <div className={styles.descriptionLabel}>Run the following command to get started:</div>
      <CodeExample code="coder projects create" />
    </div>
  )

  const emptyState = <EmptyState message="No projects have been created yet" description={description} />

  const tableProps = {
    title: "All Projects",
    columns: columns,
    emptyState: emptyState,
    data: projects,
  }

  const subTitle = `${projects.length} total`

  return (
    <div className={styles.root}>
      <Navbar user={me} onSignOut={() => userSend("SIGN_OUT")} />
      <Header title="Projects" subTitle={subTitle} />
      <Paper style={{ maxWidth: "1380px", margin: "1em auto", width: "100%" }}>
        <Table {...tableProps} />
      </Paper>
      <Footer />
    </div>
  )
}

const useStyles = makeStyles((theme) => ({
  root: {
    display: "flex",
    flexDirection: "column",
  },
  descriptionLabel: {
    marginBottom: theme.spacing(1),
  },
}))

export default ProjectsPage
