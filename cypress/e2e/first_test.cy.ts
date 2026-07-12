describe('Subtrack Renderer Plugin Tests', () => {
  it('loads the plugin and displays subtrack-rendered features', () => {
    // Load the test session with subtrack configuration
    cy.fixture('subtrack_test.json').then(sessionData => {
      cy.writeFile(
        '.jbrowse/subtrack_test.json',
        JSON.stringify(sessionData, null, 2),
      )
      cy.visit('/?config=subtrack_test.json')

      // Wait for the linear genome view to load
      cy.get('[data-testid="linear-genome-view"]', { timeout: 10000 }).should(
        'be.visible',
      )

      // Verify the subtrack-rendered track is displayed
      cy.contains('NCBI RefSeq (Subtrack Test)').should('be.visible')

      // Check that subtrack labels are visible
      cy.contains('Genes').should('be.visible')
      cy.contains('Regions').should('be.visible')
    })
  })

  it('renders features in separate subtracks', () => {
    cy.fixture('subtrack_test.json').then(sessionData => {
      cy.writeFile(
        '.jbrowse/subtrack_test.json',
        JSON.stringify(sessionData, null, 2),
      )
      cy.visit('/?config=subtrack_test.json')

      // Wait for features to render
      cy.get('[data-testid="linear-genome-view"]', { timeout: 10000 }).should(
        'be.visible',
      )

      // Verify that the track container has rendered
      cy.get('canvas').should('exist')
    })
  })
})
